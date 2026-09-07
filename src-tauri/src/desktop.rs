use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use tauri::{ipc::Channel, Manager, State};
use zeroize::Zeroizing;

use crate::{
    engine::{Engine, TurnEvent, VaultStatus},
    models::{Message, MessageRole, MessageStatus, Session},
    provider::{self, ChatMessage, ModelInfo, ProviderError},
};

struct DesktopState(Arc<Engine>);

async fn blocking<T: Send + 'static>(
    state: &State<'_, DesktopState>,
    operation: impl FnOnce(&Engine) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let engine = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || operation(&engine))
        .await
        .map_err(|_| "The desktop operation was interrupted. Try again.".to_owned())?
}

#[tauri::command]
async fn get_vault_status(state: State<'_, DesktopState>) -> Result<VaultStatus, String> {
    blocking(&state, Engine::reconnect_renderer).await
}

#[tauri::command]
async fn create_vault(state: State<'_, DesktopState>, passphrase: String) -> Result<(), String> {
    let passphrase = Zeroizing::new(passphrase);
    blocking(&state, move |engine| engine.unlock(&passphrase, true)).await
}

#[tauri::command]
async fn unlock_vault(state: State<'_, DesktopState>, passphrase: String) -> Result<(), String> {
    let passphrase = Zeroizing::new(passphrase);
    blocking(&state, move |engine| engine.unlock(&passphrase, false)).await
}

#[tauri::command]
async fn lock_vault(state: State<'_, DesktopState>) -> Result<(), String> {
    blocking(&state, Engine::lock).await
}

#[tauri::command]
async fn list_sessions(state: State<'_, DesktopState>) -> Result<Vec<Session>, String> {
    blocking(&state, Engine::list_sessions).await
}

#[tauri::command]
async fn create_session(state: State<'_, DesktopState>) -> Result<Session, String> {
    blocking(&state, Engine::create_session).await
}

#[tauri::command]
async fn list_messages(
    state: State<'_, DesktopState>,
    session_id: String,
) -> Result<Vec<Message>, String> {
    blocking(&state, move |engine| engine.list_messages(&session_id)).await
}

#[tauri::command]
async fn list_models(
    state: State<'_, DesktopState>,
    base_url: String,
) -> Result<Vec<ModelInfo>, String> {
    state.0.require_unlocked()?;
    let models = provider::list_models(&base_url)
        .await
        .map_err(|error| error.to_string())?;
    state.0.require_unlocked()?;
    Ok(models)
}

#[tauri::command]
async fn cancel_turn(state: State<'_, DesktopState>) -> Result<(), String> {
    state.0.cancel_turn()
}

#[tauri::command]
async fn send_message(
    state: State<'_, DesktopState>,
    session_id: String,
    content: String,
    base_url: String,
    model: String,
    on_event: Channel<TurnEvent>,
) -> Result<(), String> {
    if model.trim().is_empty() || model.len() > 256 {
        return Err("Select an available local model before sending.".into());
    }
    let engine = Arc::clone(&state.0);
    let prepared = blocking(&state, move |engine| {
        engine.prepare_turn(&session_id, &content)
    })
    .await?;
    let message_id = prepared.assistant.id.clone();
    if on_event
        .send(TurnEvent::Message {
            message: prepared.user,
        })
        .is_err()
        || on_event
            .send(TurnEvent::Message {
                message: prepared.assistant,
            })
            .is_err()
    {
        engine.finish_turn(&message_id, MessageStatus::Interrupted)?;
        return Err(
            "The conversation window disconnected. Reopen the session to see the saved input."
                .into(),
        );
    }
    let history = prepared
        .history
        .into_iter()
        .map(|message| ChatMessage {
            role: match message.role {
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
            }
            .into(),
            content: message.content,
        })
        .collect();
    let mut pending = String::new();
    let mut flushed_at = Instant::now();
    let flush = |pending: &mut String| -> Result<(), ProviderError> {
        if pending.is_empty() {
            return Ok(());
        }
        engine
            .append_chunk(&message_id, pending)
            .map_err(|_| ProviderError::CallbackFailed)?;
        on_event
            .send(TurnEvent::Chunk {
                message_id: message_id.clone(),
                content: std::mem::take(pending),
            })
            .map_err(|_| ProviderError::CallbackFailed)
    };
    let mut result = provider::generate(
        &base_url,
        &model,
        history,
        prepared.cancel.clone(),
        |chunk| {
            // The provider also reports failures through its return value.
            // Only content enters the transcript or UI channel here.
            let Ok(content) = chunk else {
                return Ok(());
            };
            pending.push_str(&content);
            if pending.len() >= 128 || flushed_at.elapsed() >= Duration::from_millis(60) {
                flush(&mut pending)?;
                flushed_at = Instant::now();
            }
            Ok(())
        },
    )
    .await;
    if result.is_ok() {
        result = flush(&mut pending);
    }
    let cancelled = prepared.cancel.is_cancelled();
    let status = if result.is_ok() && !cancelled {
        MessageStatus::Complete
    } else {
        MessageStatus::Interrupted
    };
    if let Some(status) = engine.finish_turn(&message_id, status)? {
        let _ = on_event.send(TurnEvent::Finished { message_id, status });
        if let Err(error) = result {
            if !cancelled {
                let _ = on_event.send(TurnEvent::Error {
                    message: error.to_string(),
                });
            }
        }
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = app.path().app_data_dir()?.join("vault");
            app.manage(DesktopState(Arc::new(Engine::new(directory))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_vault_status,
            create_vault,
            unlock_vault,
            lock_vault,
            list_sessions,
            create_session,
            list_messages,
            list_models,
            send_message,
            cancel_turn,
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = window.state::<DesktopState>().0.lock();
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not start the Openmind desktop application");
}
