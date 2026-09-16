pub mod app_settings;
pub mod codex;
pub mod engine;
pub mod lifecycle;
pub mod models;
pub mod notes;
#[cfg(feature = "desktop")]
pub mod platform_lock;
pub mod provider;
pub mod remote;
pub mod retrieval;
pub mod scheduler;
pub mod vault;

#[cfg(feature = "desktop")]
mod desktop;

#[cfg(feature = "desktop")]
pub use desktop::run;
