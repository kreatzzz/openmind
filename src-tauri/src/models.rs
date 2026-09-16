use std::fmt;

use serde::{Deserialize, Serialize};

/// A local conversation session exposed at the native/UI boundary.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    /// Revision for optimistic session-title and branch-setting updates.
    pub revision: i64,
    /// Whether this conversation may retrieve and create internal memories.
    pub memory_enabled: bool,
    /// Whether this conversation may derive and update user notebook notes.
    pub notes_enabled: bool,
}

impl fmt::Debug for Session {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Session")
            .field("id", &self.id)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .field("revision", &self.revision)
            .field("memory_enabled", &self.memory_enabled)
            .field("notes_enabled", &self.notes_enabled)
            .finish_non_exhaustive()
    }
}

/// The two durable transcript roles supported by the first vault schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
}

impl MessageRole {
    pub(crate) const fn as_db_value(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }

    pub(crate) fn from_db_value(value: &str) -> Option<Self> {
        match value {
            "user" => Some(Self::User),
            "assistant" => Some(Self::Assistant),
            _ => None,
        }
    }
}

/// The lifecycle state of a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageStatus {
    Complete,
    Streaming,
    Interrupted,
}

impl MessageStatus {
    pub(crate) const fn as_db_value(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Streaming => "streaming",
            Self::Interrupted => "interrupted",
        }
    }

    pub(crate) fn from_db_value(value: &str) -> Option<Self> {
        match value {
            "complete" => Some(Self::Complete),
            "streaming" => Some(Self::Streaming),
            "interrupted" => Some(Self::Interrupted),
            _ => None,
        }
    }

    pub(crate) const fn is_terminal(self) -> bool {
        matches!(self, Self::Complete | Self::Interrupted)
    }
}

/// A transcript row returned to the UI.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: MessageRole,
    pub content: String,
    pub status: MessageStatus,
    pub created_at: String,
}

impl fmt::Debug for Message {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Message")
            .field("id", &self.id)
            .field("session_id", &self.session_id)
            .field("role", &self.role)
            .field("status", &self.status)
            .field("created_at", &self.created_at)
            .field("content_len", &self.content.len())
            .finish_non_exhaustive()
    }
}
