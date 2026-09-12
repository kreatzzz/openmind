use std::fmt;

use serde::{Deserialize, Serialize};

/// The kinds of durable internal memory that can be proposed from a user's
/// own message. These records stay inside the encrypted vault.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryKind {
    Person,
    Event,
    Goal,
    Preference,
    Concern,
}

impl MemoryKind {
    pub(crate) const fn as_db_value(self) -> &'static str {
        match self {
            Self::Person => "person",
            Self::Event => "event",
            Self::Goal => "goal",
            Self::Preference => "preference",
            Self::Concern => "concern",
        }
    }

    pub(crate) fn from_db_value(value: &str) -> Option<Self> {
        match value {
            "person" => Some(Self::Person),
            "event" => Some(Self::Event),
            "goal" => Some(Self::Goal),
            "preference" => Some(Self::Preference),
            "concern" => Some(Self::Concern),
            _ => None,
        }
    }
}

impl fmt::Debug for MemoryKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Person => "Person",
            Self::Event => "Event",
            Self::Goal => "Goal",
            Self::Preference => "Preference",
            Self::Concern => "Concern",
        })
    }
}

/// A bounded, source-backed internal-memory proposal.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCandidate {
    pub kind: MemoryKind,
    pub content: String,
    pub evidence_quote: String,
}

impl fmt::Debug for MemoryCandidate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MemoryCandidate")
            .field("kind", &self.kind)
            .field("content_len", &self.content.len())
            .field("evidence_quote_len", &self.evidence_quote.len())
            .finish()
    }
}

/// The kinds of user-visible notebook entry generated from a conversation.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteKind {
    Takeaway,
    Question,
    NextStep,
}

impl NoteKind {
    pub(crate) const fn as_db_value(self) -> &'static str {
        match self {
            Self::Takeaway => "takeaway",
            Self::Question => "question",
            Self::NextStep => "next_step",
        }
    }

    pub(crate) fn from_db_value(value: &str) -> Option<Self> {
        match value {
            "takeaway" => Some(Self::Takeaway),
            "question" => Some(Self::Question),
            "next_step" => Some(Self::NextStep),
            _ => None,
        }
    }
}

impl fmt::Debug for NoteKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Takeaway => "Takeaway",
            Self::Question => "Question",
            Self::NextStep => "NextStep",
        })
    }
}

/// A bounded, source-backed user-notebook proposal.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteCandidate {
    pub kind: NoteKind,
    pub content: String,
    pub evidence_quote: String,
}

impl fmt::Debug for NoteCandidate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NoteCandidate")
            .field("kind", &self.kind)
            .field("content_len", &self.content.len())
            .field("evidence_quote_len", &self.evidence_quote.len())
            .finish()
    }
}

/// The single structured output accepted for a completed assistant turn.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotePatch {
    pub memories: Vec<MemoryCandidate>,
    pub notes: Vec<NoteCandidate>,
}

/// The validation result is deliberately coarse so malformed model output
/// cannot echo candidate plaintext through an error or debug formatter.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum NotePatchValidationError {
    TooManyMemories,
    TooManyNotes,
    EmptyContent,
    ContentTooLong,
    EmptyEvidenceQuote,
    EvidenceQuoteTooLong,
    EvidenceQuoteNotInSource,
}

impl fmt::Debug for NotePatchValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::TooManyMemories => "TooManyMemories",
            Self::TooManyNotes => "TooManyNotes",
            Self::EmptyContent => "EmptyContent",
            Self::ContentTooLong => "ContentTooLong",
            Self::EmptyEvidenceQuote => "EmptyEvidenceQuote",
            Self::EvidenceQuoteTooLong => "EvidenceQuoteTooLong",
            Self::EvidenceQuoteNotInSource => "EvidenceQuoteNotInSource",
        })
    }
}

impl fmt::Display for NotePatchValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::TooManyMemories => "too many memories",
            Self::TooManyNotes => "too many notes",
            Self::EmptyContent => "note content is empty",
            Self::ContentTooLong => "note content is too long",
            Self::EmptyEvidenceQuote => "evidence quote is empty",
            Self::EvidenceQuoteTooLong => "evidence quote is too long",
            Self::EvidenceQuoteNotInSource => "evidence quote is not in the source",
        })
    }
}

impl std::error::Error for NotePatchValidationError {}

impl NotePatch {
    /// Check the complete bounded patch against the current persisted user
    /// source. The vault repeats this inside its write transaction.
    pub fn validate_against_source(&self, source: &str) -> Result<(), NotePatchValidationError> {
        self.validate_shape()?;
        for candidate in &self.memories {
            validate_candidate(&candidate.content, &candidate.evidence_quote, source)?;
        }
        for candidate in &self.notes {
            validate_candidate(&candidate.content, &candidate.evidence_quote, source)?;
        }
        Ok(())
    }

    pub(crate) fn validate_shape(&self) -> Result<(), NotePatchValidationError> {
        if self.memories.len() > MAX_CANDIDATES {
            return Err(NotePatchValidationError::TooManyMemories);
        }
        if self.notes.len() > MAX_CANDIDATES {
            return Err(NotePatchValidationError::TooManyNotes);
        }
        for candidate in &self.memories {
            validate_candidate_shape(&candidate.content, &candidate.evidence_quote)?;
        }
        for candidate in &self.notes {
            validate_candidate_shape(&candidate.content, &candidate.evidence_quote)?;
        }
        Ok(())
    }
}

fn validate_candidate_shape(
    content: &str,
    evidence_quote: &str,
) -> Result<(), NotePatchValidationError> {
    if content.trim().is_empty() {
        return Err(NotePatchValidationError::EmptyContent);
    }
    if content.chars().count() > MAX_CANDIDATE_CONTENT_CHARS {
        return Err(NotePatchValidationError::ContentTooLong);
    }
    if evidence_quote.is_empty() {
        return Err(NotePatchValidationError::EmptyEvidenceQuote);
    }
    if evidence_quote.chars().count() > MAX_EVIDENCE_QUOTE_CHARS {
        return Err(NotePatchValidationError::EvidenceQuoteTooLong);
    }
    Ok(())
}

fn validate_candidate(
    content: &str,
    evidence_quote: &str,
    source: &str,
) -> Result<(), NotePatchValidationError> {
    if content.trim().is_empty() {
        return Err(NotePatchValidationError::EmptyContent);
    }
    if content.chars().count() > MAX_CANDIDATE_CONTENT_CHARS {
        return Err(NotePatchValidationError::ContentTooLong);
    }
    if evidence_quote.is_empty() {
        return Err(NotePatchValidationError::EmptyEvidenceQuote);
    }
    if evidence_quote.chars().count() > MAX_EVIDENCE_QUOTE_CHARS {
        return Err(NotePatchValidationError::EvidenceQuoteTooLong);
    }
    if !source.contains(evidence_quote) {
        return Err(NotePatchValidationError::EvidenceQuoteNotInSource);
    }
    Ok(())
}

impl fmt::Debug for NotePatch {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NotePatch")
            .field("memories_len", &self.memories.len())
            .field("notes_len", &self.notes.len())
            .finish()
    }
}

/// A notebook entry returned to the UI. Deleted entries remain encrypted
/// tombstones but are omitted from this public list.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserNote {
    pub id: String,
    pub session_id: String,
    pub source_message_id: String,
    pub kind: NoteKind,
    pub content: String,
    pub evidence_quote: String,
    pub revision: i64,
    pub edited: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl fmt::Debug for UserNote {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("UserNote")
            .field("id", &self.id)
            .field("session_id", &self.session_id)
            .field("source_message_id", &self.source_message_id)
            .field("kind", &self.kind)
            .field("content_len", &self.content.len())
            .field("evidence_quote_len", &self.evidence_quote.len())
            .field("revision", &self.revision)
            .field("edited", &self.edited)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

/// The persisted source messages supplied to the structured notes call.
#[derive(Clone, PartialEq, Eq)]
pub struct NotesInput {
    pub assistant_id: String,
    pub user: crate::models::Message,
    pub assistant: crate::models::Message,
}

impl fmt::Debug for NotesInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NotesInput")
            .field("assistant_id", &self.assistant_id)
            .field("user", &self.user)
            .field("assistant", &self.assistant)
            .finish()
    }
}

pub(crate) const MAX_CANDIDATES: usize = 8;
pub(crate) const MAX_CANDIDATE_CONTENT_CHARS: usize = 600;
pub(crate) const MAX_EVIDENCE_QUOTE_CHARS: usize = 600;
