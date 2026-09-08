pub mod engine;
pub mod models;
pub mod notes;
pub mod provider;
pub mod vault;

#[cfg(feature = "desktop")]
mod desktop;

#[cfg(feature = "desktop")]
pub use desktop::run;
