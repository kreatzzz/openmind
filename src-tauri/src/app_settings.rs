use serde::{Deserialize, Serialize};

use crate::engine::ProviderKind;

pub const DEFAULT_OLLAMA_URL: &str = "http://127.0.0.1:11434";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    pub provider: ProviderKind,
    pub base_url: String,
    pub model: String,
    pub remote_data_consent: bool,
    pub credential_present: bool,
    pub revision: i64,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            provider: ProviderKind::Ollama,
            base_url: DEFAULT_OLLAMA_URL.into(),
            model: String::new(),
            remote_data_consent: false,
            credential_present: false,
            revision: 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineWidth {
    Compact,
    Comfortable,
    Wide,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSettings {
    pub text_scale_percent: u16,
    pub line_width: LineWidth,
    pub reduce_motion: bool,
    pub enter_to_send: bool,
    pub revision: i64,
}

impl Default for ReadingSettings {
    fn default() -> Self {
        Self {
            text_scale_percent: 100,
            line_width: LineWidth::Comfortable,
            reduce_motion: false,
            enter_to_send: true,
            revision: 1,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub streaming: bool,
    pub structured_notes: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderHealthStatus {
    Ready,
    Unavailable,
    AuthRequired,
    Misconfigured,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderDestination {
    Local,
    Remote,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub provider: ProviderKind,
    pub status: ProviderHealthStatus,
    pub destination: ProviderDestination,
    pub model: String,
    pub capabilities: ProviderCapabilities,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteJob {
    pub message_id: String,
    pub status: String,
    pub attempt_count: u32,
    pub next_attempt_at: Option<String>,
    pub last_error_code: Option<String>,
    pub memory_enabled: bool,
    pub notes_enabled: bool,
    pub provider: ProviderKind,
    pub model: String,
    pub created_at: String,
    pub updated_at: String,
}
