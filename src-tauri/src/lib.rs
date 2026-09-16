pub mod app_settings;
pub mod codex;
pub mod engine;
pub mod models;
pub mod notes;
pub mod provider;
pub mod scheduler;
pub mod remote;
pub mod vault;

#[cfg(feature = "desktop")]
mod desktop;

#[cfg(feature = "desktop")]
pub use desktop::run;
