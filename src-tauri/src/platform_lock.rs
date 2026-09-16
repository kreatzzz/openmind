//! Native session and power events that require an unlocked vault to close.
//!
//! Platform callbacks carry no conversation data. Their only effect is to ask
//! the desktop layer to lock, which cancels active work and releases the vault.

use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LockEvent {
    SessionLocked,
    SessionInactive,
    Suspending,
}

pub type LockCallback = Arc<dyn Fn(LockEvent) + Send + Sync + 'static>;

#[cfg(windows)]
pub struct LockMonitor {
    _inner: windows_impl::Monitor,
}

#[cfg(windows)]
impl LockMonitor {
    pub fn start(callback: LockCallback) -> Result<Self, String> {
        windows_impl::Monitor::start(callback).map(|_inner| Self { _inner })
    }
}

#[cfg(target_os = "macos")]
pub fn install_macos_monitor(callback: LockCallback) -> Result<(), String> {
    macos_impl::install(callback)
}

#[cfg(target_os = "macos")]
pub fn stop_macos_monitor() {
    macos_impl::stop();
}

#[cfg(windows)]
mod windows_impl {
    use std::{
        mem::MaybeUninit,
        sync::{mpsc, Arc, OnceLock},
        thread::{self, JoinHandle},
    };

    use windows::{
        core::w,
        Win32::{
            Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
            System::{
                LibraryLoader::GetModuleHandleW,
                RemoteDesktop::{
                    WTSRegisterSessionNotification, WTSUnRegisterSessionNotification,
                    NOTIFY_FOR_THIS_SESSION,
                },
                Threading::GetCurrentThreadId,
            },
            UI::WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
                PostThreadMessageW, RegisterClassW, SetWindowLongPtrW, TranslateMessage,
                CREATESTRUCTW, GWLP_USERDATA, MSG, PBT_APMSUSPEND, WINDOW_EX_STYLE, WM_NCCREATE,
                WM_POWERBROADCAST, WM_QUIT, WM_WTSSESSION_CHANGE, WNDCLASSW, WS_OVERLAPPED,
                WTS_CONSOLE_DISCONNECT, WTS_REMOTE_DISCONNECT, WTS_SESSION_LOCK,
            },
        },
    };

    use super::{LockCallback, LockEvent};

    struct WindowState {
        callback: LockCallback,
    }

    static CLASS_REGISTRATION: OnceLock<Result<(), String>> = OnceLock::new();

    pub struct Monitor {
        thread_id: u32,
        thread: Option<JoinHandle<()>>,
    }

    impl Monitor {
        pub fn start(callback: LockCallback) -> Result<Self, String> {
            let (ready_tx, ready_rx) = mpsc::sync_channel(1);
            let thread = thread::Builder::new()
                .name("openmind-session-lock".into())
                .spawn(move || {
                    let result = unsafe { create_message_window(callback) };
                    let _ = ready_tx.send(
                        result
                            .as_ref()
                            .map(|(thread_id, _)| *thread_id)
                            .map_err(Clone::clone),
                    );
                    if let Ok((thread_id, window)) = result {
                        unsafe { run_message_loop() };
                        unsafe {
                            let _ = WTSUnRegisterSessionNotification(window);
                            let _ = DestroyWindow(window);
                        }
                        let _ = thread_id;
                    }
                })
                .map_err(|_| "Could not start the Windows session monitor.".to_owned())?;
            match ready_rx.recv() {
                Ok(Ok(thread_id)) => Ok(Self {
                    thread_id,
                    thread: Some(thread),
                }),
                Ok(Err(error)) => {
                    let _ = thread.join();
                    Err(error)
                }
                Err(_) => {
                    let _ = thread.join();
                    Err("The Windows session monitor stopped during startup.".into())
                }
            }
        }
    }

    impl Drop for Monitor {
        fn drop(&mut self) {
            unsafe {
                let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    fn session_event(code: u32) -> Option<LockEvent> {
        match code {
            WTS_SESSION_LOCK => Some(LockEvent::SessionLocked),
            WTS_CONSOLE_DISCONNECT | WTS_REMOTE_DISCONNECT => Some(LockEvent::SessionInactive),
            _ => None,
        }
    }

    unsafe fn create_message_window(callback: LockCallback) -> Result<(u32, HWND), String> {
        let class_name = w!("OpenmindSessionLockMonitor");
        let module = unsafe { GetModuleHandleW(None) }
            .map_err(|_| "Could not identify the Windows application module.".to_owned())?;
        let instance = HINSTANCE(module.0);
        CLASS_REGISTRATION
            .get_or_init(|| {
                let window_class = WNDCLASSW {
                    hInstance: instance,
                    lpfnWndProc: Some(window_proc),
                    lpszClassName: class_name,
                    ..Default::default()
                };
                if unsafe { RegisterClassW(&window_class) } == 0 {
                    Err("Could not register the Windows session monitor.".into())
                } else {
                    Ok(())
                }
            })
            .clone()?;
        let state = Arc::new(WindowState { callback });
        let window = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                class_name,
                w!("Openmind native lifecycle monitor"),
                WS_OVERLAPPED,
                0,
                0,
                0,
                0,
                None,
                None,
                Some(instance),
                Some(Arc::as_ptr(&state).cast()),
            )
        };
        let window = match window {
            Ok(window) => window,
            Err(_) => return Err("Could not create the Windows session monitor.".into()),
        };
        drop(state);
        if unsafe { WTSRegisterSessionNotification(window, NOTIFY_FOR_THIS_SESSION) }.is_err() {
            unsafe { DestroyWindow(window).ok() };
            return Err("Could not subscribe to Windows session lock events.".into());
        }
        Ok((unsafe { GetCurrentThreadId() }, window))
    }

    unsafe fn run_message_loop() {
        let mut message = MaybeUninit::<MSG>::zeroed();
        loop {
            let result = unsafe { GetMessageW(message.as_mut_ptr(), None, 0, 0) }.0;
            if result <= 0 {
                break;
            }
            let message = unsafe { message.assume_init() };
            unsafe {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }

    unsafe extern "system" fn window_proc(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_NCCREATE {
            let create = lparam.0 as *const CREATESTRUCTW;
            if !create.is_null() {
                let state = unsafe { (*create).lpCreateParams as *const WindowState };
                unsafe {
                    Arc::increment_strong_count(state);
                    SetWindowLongPtrW(window, GWLP_USERDATA, state as isize);
                }
            }
        }
        let state = unsafe {
            windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(window, GWLP_USERDATA)
                as *mut WindowState
        };
        if !state.is_null() {
            if message == WM_WTSSESSION_CHANGE {
                if let Some(event) = session_event(wparam.0 as u32) {
                    ((*state).callback)(event);
                }
            } else if message == WM_POWERBROADCAST && wparam.0 as u32 == PBT_APMSUSPEND {
                ((*state).callback)(LockEvent::Suspending);
                return LRESULT(1);
            }
        }
        if message == windows::Win32::UI::WindowsAndMessaging::WM_NCDESTROY && !state.is_null() {
            unsafe {
                SetWindowLongPtrW(window, GWLP_USERDATA, 0);
                drop(Arc::from_raw(state));
            }
        }
        unsafe { DefWindowProcW(window, message, wparam, lparam) }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn monitor_can_restart_without_leaking_its_window_thread() {
            for _ in 0..2 {
                let monitor = Monitor::start(Arc::new(|_| {})).unwrap();
                drop(monitor);
            }
        }

        #[test]
        fn lock_and_disconnect_events_close_the_vault_boundary() {
            assert_eq!(
                session_event(WTS_SESSION_LOCK),
                Some(LockEvent::SessionLocked)
            );
            assert_eq!(
                session_event(WTS_CONSOLE_DISCONNECT),
                Some(LockEvent::SessionInactive)
            );
            assert_eq!(
                session_event(WTS_REMOTE_DISCONNECT),
                Some(LockEvent::SessionInactive)
            );
            assert_eq!(session_event(0), None);
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use std::{cell::RefCell, ptr::NonNull};

    use block2::RcBlock;
    use objc2::{runtime::ProtocolObject, MainThreadMarker};
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceScreensDidSleepNotification,
        NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol};

    use super::{LockCallback, LockEvent};

    pub struct Monitor {
        center: objc2::rc::Retained<NSNotificationCenter>,
        observers: Vec<objc2::rc::Retained<ProtocolObject<dyn NSObjectProtocol>>>,
    }

    thread_local! {
        static MONITOR: RefCell<Option<Monitor>> = const { RefCell::new(None) };
    }

    pub fn install(callback: LockCallback) -> Result<(), String> {
        let monitor = Monitor::start(callback)?;
        MONITOR.with(|slot| {
            if slot.borrow().is_some() {
                return Err("The macOS session monitor is already running.".into());
            }
            *slot.borrow_mut() = Some(monitor);
            Ok(())
        })
    }

    pub fn stop() {
        assert!(
            MainThreadMarker::new().is_some(),
            "the macOS session monitor must stop on the main thread"
        );
        MONITOR.with(|slot| {
            slot.borrow_mut().take();
        });
    }

    impl Monitor {
        pub fn start(callback: LockCallback) -> Result<Self, String> {
            MainThreadMarker::new()
                .ok_or("The macOS session monitor must start on the main thread.")?;
            let workspace = NSWorkspace::sharedWorkspace();
            let center = workspace.notificationCenter();
            let session_callback = callback.clone();
            let session_block = RcBlock::new(move |_: NonNull<NSNotification>| {
                session_callback(LockEvent::SessionInactive);
            });
            let sleep_callback = callback.clone();
            let sleep_block = RcBlock::new(move |_: NonNull<NSNotification>| {
                sleep_callback(LockEvent::Suspending);
            });
            let screen_block = RcBlock::new(move |_: NonNull<NSNotification>| {
                callback(LockEvent::SessionInactive);
            });
            let session_observer = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceSessionDidResignActiveNotification),
                    None,
                    None,
                    &session_block,
                )
            };
            let sleep_observer = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceWillSleepNotification),
                    None,
                    None,
                    &sleep_block,
                )
            };
            let screen_observer = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceScreensDidSleepNotification),
                    None,
                    None,
                    &screen_block,
                )
            };
            Ok(Self {
                center,
                observers: vec![session_observer, sleep_observer, screen_observer],
            })
        }
    }

    impl Drop for Monitor {
        fn drop(&mut self) {
            for observer in &self.observers {
                unsafe { self.center.removeObserver(observer.as_ref().as_ref()) };
            }
        }
    }
}
