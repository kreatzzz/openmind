use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use chrono::{SecondsFormat, Utc};
use fs2::FileExt;
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::models::{Message, MessageRole, MessageStatus, Session};
use crate::notes::{
    MemoryEvidenceState, MemoryKind, MemoryRecord, NoteKind, NotePatch, NotesInput, UserNote,
    MAX_CANDIDATE_CONTENT_CHARS, MAX_EVIDENCE_QUOTE_CHARS,
};

pub const DATABASE_FILE_NAME: &str = "vault.db";
pub const ENVELOPE_FILE_NAME: &str = "vault.key";
pub const LOCK_FILE_NAME: &str = "vault.lock";

pub const MIN_PASSPHRASE_CHARS: usize = 12;
pub const MAX_PASSPHRASE_BYTES: usize = 1024;
pub const MAX_USER_MESSAGE_CHARS: usize = 32_000;
pub const MAX_ASSISTANT_CHUNK_CHARS: usize = 32_000;
pub const MAX_ASSISTANT_MESSAGE_CHARS: usize = 200_000;
pub const MAX_SESSION_TITLE_CHARS: usize = 120;

const SCHEMA_VERSION: i32 = 3;
const DB_KEY_LENGTH: usize = 32;
const ENVELOPE_SALT_LENGTH: usize = 16;
const ENVELOPE_NONCE_LENGTH: usize = 24;
const ENVELOPE_TAG_LENGTH: usize = 16;
const ENVELOPE_MAGIC: &[u8; 8] = b"OMVLT001";
const ENVELOPE_VERSION: u8 = 1;

// An RFC 9106-informed memory-conscious Argon2id profile, adapted to one
// lane and kept fixed and bounded so envelope fields cannot choose an
// allocation size during unlock.
pub const KDF_MEMORY_KIB: u32 = 64 * 1024;
pub const KDF_TIME_COST: u32 = 3;
pub const KDF_PARALLELISM: u32 = 1;

const ENVELOPE_HEADER_LENGTH: usize =
    8 + 1 + 4 + 4 + 4 + ENVELOPE_SALT_LENGTH + ENVELOPE_NONCE_LENGTH;
const ENVELOPE_LENGTH: usize = ENVELOPE_HEADER_LENGTH + DB_KEY_LENGTH + ENVELOPE_TAG_LENGTH;

pub type Result<T> = std::result::Result<T, VaultError>;

#[derive(Debug)]
pub enum VaultError {
    VaultExists,
    VaultNotFound,
    VaultIncomplete,
    InvalidPassphrase,
    InvalidInput(&'static str),
    SessionNotFound,
    MessageNotFound,
    MessageNotStreaming,
    AssistantAlreadyStreaming,
    InvalidMessageRole,
    InvalidMessageStatus,
    AssistantNotComplete,
    NotesJobNotFound,
    NotesJobAlreadyRunning,
    NotesAlreadyComplete,
    NotesSourceNotFound,
    InvalidNotesPatch,
    MemoryNotFound,
    MemoryDeleted,
    MemorySourceForgotten,
    MemoryRevisionConflict,
    NoteNotFound,
    NoteDeleted,
    RevisionConflict,
    CorruptEnvelope,
    CorruptDatabase,
    EncryptionUnavailable,
    Io,
    Database,
    Crypto,
}

impl fmt::Display for VaultError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::VaultExists => formatter.write_str("vault already exists"),
            Self::VaultNotFound => formatter.write_str("vault not found"),
            Self::VaultIncomplete => formatter.write_str("vault is incomplete"),
            Self::InvalidPassphrase => formatter.write_str("invalid passphrase"),
            Self::InvalidInput(reason) => write!(formatter, "invalid input: {reason}"),
            Self::SessionNotFound => formatter.write_str("session not found"),
            Self::MessageNotFound => formatter.write_str("message not found"),
            Self::MessageNotStreaming => formatter.write_str("message is not streaming"),
            Self::AssistantAlreadyStreaming => formatter.write_str("a reply is already streaming"),
            Self::InvalidMessageRole => {
                formatter.write_str("message role is invalid for this operation")
            }
            Self::InvalidMessageStatus => {
                formatter.write_str("message status is invalid for this operation")
            }
            Self::AssistantNotComplete => formatter.write_str("assistant message is not complete"),
            Self::NotesJobNotFound => formatter.write_str("notes job not found"),
            Self::NotesJobAlreadyRunning => formatter.write_str("notes job is already running"),
            Self::NotesAlreadyComplete => formatter.write_str("notes job is already complete"),
            Self::NotesSourceNotFound => formatter.write_str("notes source message not found"),
            Self::InvalidNotesPatch => formatter.write_str("notes patch is invalid"),
            Self::MemoryNotFound => formatter.write_str("memory not found"),
            Self::MemoryDeleted => formatter.write_str("memory has been deleted"),
            Self::MemorySourceForgotten => formatter.write_str("memory source has been forgotten"),
            Self::MemoryRevisionConflict => formatter.write_str("memory revision conflict"),
            Self::NoteNotFound => formatter.write_str("note not found"),
            Self::NoteDeleted => formatter.write_str("note has been deleted"),
            Self::RevisionConflict => formatter.write_str("note revision conflict"),
            Self::CorruptEnvelope => formatter.write_str("vault key envelope is corrupt"),
            Self::CorruptDatabase => formatter.write_str("vault database is corrupt"),
            Self::EncryptionUnavailable => {
                formatter.write_str("SQLCipher encryption is unavailable")
            }
            Self::Io => formatter.write_str("vault I/O error"),
            Self::Database => formatter.write_str("vault database error"),
            Self::Crypto => formatter.write_str("vault cryptography error"),
        }
    }
}

impl std::error::Error for VaultError {}

impl From<io::Error> for VaultError {
    fn from(_: io::Error) -> Self {
        Self::Io
    }
}

impl From<rusqlite::Error> for VaultError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Database
    }
}

pub struct Vault {
    connection: Connection,
    db_key: Zeroizing<[u8; DB_KEY_LENGTH]>,
    _lock_file: File,
}

impl fmt::Debug for Vault {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Vault")
            .field("unlocked", &true)
            .finish_non_exhaustive()
    }
}

impl Drop for Vault {
    fn drop(&mut self) {
        self.db_key.zeroize();
    }
}

impl Vault {
    pub fn create<P: AsRef<Path>>(dir: P, passphrase: &str) -> Result<Self> {
        validate_passphrase(passphrase)?;

        let dir = dir.as_ref();
        fs::create_dir_all(dir)?;
        if !dir.is_dir() {
            return Err(VaultError::InvalidInput("vault path is not a directory"));
        }

        let lock_file = acquire_lock(dir)?;

        let database_path = dir.join(DATABASE_FILE_NAME);
        let envelope_path = dir.join(ENVELOPE_FILE_NAME);
        if database_path.exists() || envelope_path.exists() {
            return Err(VaultError::VaultExists);
        }

        let db_key = random_key();
        let temporary_database_path = temporary_path(&database_path);
        let connection = match open_connection(&temporary_database_path, &db_key, true) {
            Ok(connection) => connection,
            Err(error) => {
                cleanup_sqlite_files(&temporary_database_path);
                return Err(error);
            }
        };
        if let Err(error) = finalize_new_database(&connection) {
            drop(connection);
            cleanup_sqlite_files(&temporary_database_path);
            return Err(error);
        }
        drop(connection);

        if let Err(error) = rename_new(&temporary_database_path, &database_path) {
            cleanup_sqlite_files(&temporary_database_path);
            return Err(error);
        }

        let envelope = match encode_envelope(passphrase, &db_key) {
            Ok(envelope) => envelope,
            Err(error) => {
                cleanup_sqlite_files(&database_path);
                return Err(error);
            }
        };
        if let Err(error) = atomic_write_new(&envelope_path, &envelope) {
            if !matches!(&error, VaultError::VaultExists) {
                cleanup_sqlite_files(&database_path);
                let _ = fs::remove_file(&envelope_path);
            }
            return Err(error);
        }

        let connection = match open_connection(&database_path, &db_key, false) {
            Ok(connection) => connection,
            Err(error) => {
                cleanup_sqlite_files(&database_path);
                let _ = fs::remove_file(&envelope_path);
                return Err(error);
            }
        };
        if let Err(error) = recover_interrupted(&connection) {
            drop(connection);
            cleanup_sqlite_files(&database_path);
            let _ = fs::remove_file(&envelope_path);
            return Err(error);
        }

        Ok(Self {
            connection,
            db_key,
            _lock_file: lock_file,
        })
    }

    pub fn open<P: AsRef<Path>>(dir: P, passphrase: &str) -> Result<Self> {
        validate_passphrase(passphrase)?;

        let dir = dir.as_ref();
        if !dir.is_dir() {
            return Err(VaultError::VaultNotFound);
        }
        let lock_file = acquire_lock(dir)?;
        let database_path = dir.join(DATABASE_FILE_NAME);
        let envelope_path = dir.join(ENVELOPE_FILE_NAME);
        match (database_path.exists(), envelope_path.exists()) {
            (false, false) => return Err(VaultError::VaultNotFound),
            (true, false) | (false, true) => return Err(VaultError::VaultIncomplete),
            (true, true) => {}
        }

        let mut db_key = decode_envelope(passphrase, &envelope_path)?;
        if has_sqlite_header(&database_path)? {
            db_key.zeroize();
            return Err(VaultError::CorruptDatabase);
        }

        let connection = match open_connection(&database_path, &db_key, false) {
            Ok(connection) => connection,
            Err(error) => {
                db_key.zeroize();
                return Err(error);
            }
        };
        recover_interrupted(&connection)?;

        Ok(Self {
            connection,
            db_key,
            _lock_file: lock_file,
        })
    }

    pub fn exists<P: AsRef<Path>>(dir: P) -> bool {
        let dir = dir.as_ref();
        dir.join(DATABASE_FILE_NAME).exists() || dir.join(ENVELOPE_FILE_NAME).exists()
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, created_at, updated_at
             FROM sessions
             ORDER BY updated_at DESC, rowid DESC",
        )?;
        let mut rows = statement.query([])?;
        let mut sessions = Vec::new();
        while let Some(row) = rows.next()? {
            sessions.push(session_from_row(row)?);
        }
        Ok(sessions)
    }

    pub fn create_session(&mut self) -> Result<Session> {
        let title = format!("{} conversation", Utc::now().format("%A"));
        self.create_session_with_title(&title)
    }

    pub fn create_session_with_title(&mut self, title: &str) -> Result<Session> {
        validate_text(title, MAX_SESSION_TITLE_CHARS, "session title")?;

        let id = Uuid::new_v4().to_string();
        let timestamp = now_rfc3339();
        let session = Session {
            id: id.clone(),
            title: title.to_owned(),
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
        };

        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                session.id,
                session.title,
                session.created_at,
                session.updated_at
            ],
        )?;
        transaction.commit()?;
        Ok(session)
    }

    /// Delete a session and all encrypted records that belong to it.
    pub fn delete_session(&mut self, session_id: &str) -> Result<()> {
        let session_id = canonical_id(session_id, "session ID")?;
        let transaction = self.connection.transaction()?;
        ensure_session(&transaction, &session_id)?;
        transaction.execute("DELETE FROM sessions WHERE id = ?1", [&session_id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn list_messages(&self, session_id: &str) -> Result<Vec<Message>> {
        let session_id = canonical_id(session_id, "session ID")?;
        ensure_session(&self.connection, &session_id)?;

        let mut statement = self.connection.prepare(
            "SELECT id, session_id, role, content, status, created_at
             FROM messages
             WHERE session_id = ?1
             ORDER BY rowid ASC",
        )?;
        let mut rows = statement.query([session_id])?;
        let mut messages = Vec::new();
        while let Some(row) = rows.next()? {
            messages.push(message_from_row(row)?);
        }
        Ok(messages)
    }

    /// Return conversation context with source turns excluded by a memory
    /// forget operation. The visible transcript remains available through
    /// `list_messages`, while the model cannot relearn a forgotten turn.
    pub fn list_context_messages(&self, session_id: &str) -> Result<Vec<Message>> {
        let session_id = canonical_id(session_id, "session ID")?;
        ensure_session(&self.connection, &session_id)?;

        let mut statement = self.connection.prepare(
            "SELECT id, session_id, role, content, status, created_at
             FROM messages
             WHERE session_id = ?1
               AND id NOT IN (
                   SELECT source_message_id
                   FROM memory_exclusions
                   WHERE source_message_id IN (
                       SELECT id FROM messages WHERE session_id = ?1
                   )
                   UNION
                   SELECT memory_records.assistant_message_id
                   FROM memory_records
                   JOIN memory_exclusions
                     ON memory_exclusions.source_message_id = memory_records.source_message_id
                   WHERE memory_records.session_id = ?1
               )
             ORDER BY rowid ASC",
        )?;
        let mut rows = statement.query([session_id])?;
        let mut messages = Vec::new();
        while let Some(row) = rows.next()? {
            messages.push(message_from_row(row)?);
        }
        Ok(messages)
    }

    /// Return active, source-backed remembered context records. Tombstones and
    /// records whose source turn was forgotten are never returned.
    pub fn list_memories(&self) -> Result<Vec<MemoryRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT memory_records.id, memory_records.session_id,
                    memory_records.source_message_id, memory_records.assistant_message_id,
                    memory_records.kind, memory_records.content,
                    memory_records.evidence_quote, memory_records.evidence_state,
                    memory_records.revision, memory_records.edited,
                    memory_records.created_at, memory_records.updated_at
             FROM memory_records
             JOIN messages AS source ON source.id = memory_records.source_message_id
             WHERE memory_records.deleted = 0
               AND source.role = 'user'
               AND NOT EXISTS (
                   SELECT 1 FROM memory_exclusions
                   WHERE memory_exclusions.source_message_id = memory_records.source_message_id
               )
             ORDER BY memory_records.updated_at DESC, memory_records.rowid DESC",
        )?;
        let mut rows = statement.query([])?;
        let mut memories = Vec::new();
        while let Some(row) = rows.next()? {
            memories.push(memory_record_from_row(row)?);
        }
        Ok(memories)
    }

    /// Correct a remembered record with an optimistic revision check. The
    /// original source and quote remain attached as provenance; the record is
    /// marked user-confirmed so retrieval does not present the correction as a
    /// fresh model extraction.
    pub fn edit_memory(
        &mut self,
        memory_id: &str,
        content: &str,
        expected_revision: i64,
    ) -> Result<MemoryRecord> {
        let memory_id = canonical_id(memory_id, "memory ID")?;
        validate_text(content, MAX_CANDIDATE_CONTENT_CHARS, "memory content")?;
        validate_revision(expected_revision)?;

        let transaction = self.connection.transaction()?;
        let existing = memory_with_deleted_from_id(&transaction, &memory_id)?;
        if existing.deleted {
            return Err(VaultError::MemoryDeleted);
        }
        if existing.memory.revision != expected_revision {
            return Err(VaultError::MemoryRevisionConflict);
        }
        if memory_source_is_excluded(&transaction, &existing.memory.source_message_id)? {
            return Err(VaultError::MemorySourceForgotten);
        }

        let updated_at = now_rfc3339();
        let changed = transaction.execute(
            "UPDATE memory_records
             SET content = ?1, evidence_state = 'user_confirmed',
                 revision = revision + 1, edited = 1, updated_at = ?2
             WHERE id = ?3 AND deleted = 0 AND revision = ?4",
            params![content, updated_at, memory_id, expected_revision],
        )?;
        if changed != 1 {
            return Err(VaultError::MemoryRevisionConflict);
        }
        let updated = memory_with_deleted_from_id(&transaction, &memory_id)?;
        transaction.commit()?;
        Ok(updated.memory)
    }

    /// Forget every derived memory from the selected source turn. The rows are
    /// content-free tombstones, and a durable source exclusion prevents a
    /// completed-turn derivation retry from recreating the forgotten records.
    pub fn delete_memory(&mut self, memory_id: &str, expected_revision: i64) -> Result<()> {
        let memory_id = canonical_id(memory_id, "memory ID")?;
        validate_revision(expected_revision)?;

        let transaction = self.connection.transaction()?;
        let existing = memory_with_deleted_from_id(&transaction, &memory_id)?;
        if existing.deleted {
            return Err(VaultError::MemoryDeleted);
        }
        if existing.memory.revision != expected_revision {
            return Err(VaultError::MemoryRevisionConflict);
        }

        let source_message_id = existing.memory.source_message_id.clone();
        let timestamp = now_rfc3339();
        transaction.execute(
            "UPDATE memory_records
             SET deleted = 1, content = '', evidence_quote = '',
                 revision = revision + 1, updated_at = ?1
             WHERE source_message_id = ?2 AND deleted = 0",
            params![timestamp, source_message_id],
        )?;
        transaction.execute(
            "INSERT INTO memory_exclusions (source_message_id, scope, created_at)
             VALUES (?1, 'source_turn', ?2)
             ON CONFLICT(source_message_id) DO NOTHING",
            params![source_message_id, timestamp],
        )?;
        // A source turn that is being forgotten cannot be processed by a
        // pending derivation. A running job is normally prevented by Engine's
        // active-work guard, but failing it here also protects direct Vault
        // callers and makes the transaction self-contained.
        transaction.execute(
            "UPDATE notes_jobs
             SET status = 'failed', updated_at = ?1
             WHERE assistant_message_id = ?2 AND status IN ('pending', 'running')",
            params![timestamp, existing.memory.assistant_message_id],
        )?;
        // Notes generated from the forgotten source are derived copies of the
        // same user disclosure. Forgetting this source turn therefore removes
        // them from the visible notebook as content-free tombstones as well;
        // an explicit UI confirmation is required before this command runs.
        transaction.execute(
            "UPDATE user_notes
             SET deleted = 1, content = '', evidence_quote = '',
                 revision = revision + 1, updated_at = ?1
             WHERE source_message_id = ?2 AND deleted = 0",
            params![timestamp, source_message_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Return the visible notebook entries. Internal memory records are kept
    /// in a separate table and intentionally have no public listing method.
    pub fn list_notes(&self) -> Result<Vec<UserNote>> {
        let mut statement = self.connection.prepare(
            "SELECT id, session_id, source_message_id, kind, content,
                    evidence_quote, revision, edited, created_at, updated_at
             FROM user_notes
             WHERE deleted = 0
             ORDER BY updated_at DESC, rowid DESC",
        )?;
        let mut rows = statement.query([])?;
        let mut notes = Vec::new();
        while let Some(row) = rows.next()? {
            notes.push(user_note_from_row(row)?);
        }
        Ok(notes)
    }

    /// Edit a user-visible notebook entry with an optimistic revision check.
    /// Generated patches only create rows, so this path always preserves a
    /// user's edit against later note generation.
    pub fn edit_note(
        &mut self,
        note_id: &str,
        content: &str,
        expected_revision: i64,
    ) -> Result<UserNote> {
        let note_id = canonical_id(note_id, "note ID")?;
        validate_text(content, MAX_CANDIDATE_CONTENT_CHARS, "note content")?;
        validate_revision(expected_revision)?;

        let transaction = self.connection.transaction()?;
        let existing = user_note_with_deleted_from_id(&transaction, &note_id)?;
        if existing.deleted {
            return Err(VaultError::NoteDeleted);
        }
        if existing.note.revision != expected_revision {
            return Err(VaultError::RevisionConflict);
        }

        let updated_at = now_rfc3339();
        let changed = transaction.execute(
            "UPDATE user_notes
             SET content = ?1, revision = revision + 1, edited = 1, updated_at = ?2
             WHERE id = ?3 AND deleted = 0 AND revision = ?4",
            params![content, updated_at, note_id, expected_revision],
        )?;
        if changed != 1 {
            return Err(VaultError::RevisionConflict);
        }
        let updated = user_note_with_deleted_from_id(&transaction, &note_id)?;
        transaction.commit()?;
        Ok(updated.note)
    }

    /// Tombstone a notebook entry. The row remains encrypted in the vault so
    /// a late generation retry cannot resurrect it.
    pub fn delete_note(&mut self, note_id: &str, expected_revision: i64) -> Result<()> {
        let note_id = canonical_id(note_id, "note ID")?;
        validate_revision(expected_revision)?;

        let transaction = self.connection.transaction()?;
        let existing = user_note_with_deleted_from_id(&transaction, &note_id)?;
        if existing.deleted {
            return Err(VaultError::NoteDeleted);
        }
        if existing.note.revision != expected_revision {
            return Err(VaultError::RevisionConflict);
        }

        let changed = transaction.execute(
            "UPDATE user_notes
             SET deleted = 1, content = '', evidence_quote = '',
                 revision = revision + 1, updated_at = ?1
             WHERE id = ?2 AND deleted = 0 AND revision = ?3",
            params![now_rfc3339(), note_id, expected_revision],
        )?;
        if changed != 1 {
            return Err(VaultError::RevisionConflict);
        }
        transaction.commit()?;
        Ok(())
    }

    /// Claim the structured derivation job for a completed assistant turn and
    /// return the exact persisted user/assistant pair it may cite.
    pub fn begin_notes(&mut self, assistant_id: &str) -> Result<NotesInput> {
        let assistant_id = canonical_id(assistant_id, "assistant message ID")?;
        let transaction = self.connection.transaction()?;
        let assistant = message_from_id(&transaction, &assistant_id)?;
        if assistant.role != MessageRole::Assistant {
            return Err(VaultError::InvalidMessageRole);
        }
        if assistant.status != MessageStatus::Complete {
            return Err(VaultError::AssistantNotComplete);
        }
        let user = source_user_message(&transaction, &assistant)?;
        if memory_source_is_excluded(&transaction, &user.id)? {
            return Err(VaultError::MemorySourceForgotten);
        }

        let status: String = transaction
            .query_row(
                "SELECT status FROM notes_jobs WHERE assistant_message_id = ?1",
                [&assistant_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(VaultError::NotesJobNotFound)?;
        match status.as_str() {
            "pending" | "failed" => {}
            "running" => return Err(VaultError::NotesJobAlreadyRunning),
            "complete" => return Err(VaultError::NotesAlreadyComplete),
            _ => return Err(VaultError::CorruptDatabase),
        }

        let changed = transaction.execute(
            "UPDATE notes_jobs
             SET status = 'running', updated_at = ?1
             WHERE assistant_message_id = ?2 AND status IN ('pending', 'failed')",
            params![now_rfc3339(), assistant_id],
        )?;
        if changed != 1 {
            return Err(VaultError::NotesJobAlreadyRunning);
        }
        transaction.commit()?;
        Ok(NotesInput {
            assistant_id,
            user,
            assistant,
        })
    }

    /// Mark an in-flight derivation failed so it can be explicitly retried.
    pub fn fail_notes(&mut self, assistant_id: &str) -> Result<()> {
        let assistant_id = canonical_id(assistant_id, "assistant message ID")?;
        let transaction = self.connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE notes_jobs
             SET status = 'failed', updated_at = ?1
             WHERE assistant_message_id = ?2 AND status = 'running'",
            params![now_rfc3339(), assistant_id],
        )?;
        if changed != 1 {
            let status: Option<String> = transaction
                .query_row(
                    "SELECT status FROM notes_jobs WHERE assistant_message_id = ?1",
                    [&assistant_id],
                    |row| row.get(0),
                )
                .optional()?;
            return match status.as_deref() {
                Some("complete") => Err(VaultError::NotesAlreadyComplete),
                Some("running") => Err(VaultError::Database),
                Some(_) => Err(VaultError::InvalidInput("notes job is not running")),
                None => Err(VaultError::NotesJobNotFound),
            };
        }
        transaction.commit()?;
        Ok(())
    }

    /// Validate and atomically apply both output branches for a claimed job.
    /// The source is looked up again inside this transaction so a patch can
    /// never cite an assistant message or a stale in-memory copy.
    pub fn apply_notes(&mut self, assistant_id: &str, patch: &NotePatch) -> Result<()> {
        let assistant_id = canonical_id(assistant_id, "assistant message ID")?;
        validate_patch_shape(patch)?;

        let transaction = self.connection.transaction()?;
        let assistant = message_from_id(&transaction, &assistant_id)?;
        if assistant.role != MessageRole::Assistant {
            return Err(VaultError::InvalidMessageRole);
        }
        if assistant.status != MessageStatus::Complete {
            return Err(VaultError::AssistantNotComplete);
        }
        let user = source_user_message(&transaction, &assistant)?;
        if memory_source_is_excluded(&transaction, &user.id)? {
            return Err(VaultError::MemorySourceForgotten);
        }
        let status: String = transaction
            .query_row(
                "SELECT status FROM notes_jobs WHERE assistant_message_id = ?1",
                [&assistant_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(VaultError::NotesJobNotFound)?;
        match status.as_str() {
            "running" => {}
            "complete" => return Err(VaultError::NotesAlreadyComplete),
            "pending" | "failed" => {
                return Err(VaultError::InvalidInput("notes job is not running"))
            }
            _ => return Err(VaultError::CorruptDatabase),
        }
        validate_patch_evidence(patch, &user.content)?;

        let timestamp = now_rfc3339();
        for candidate in &patch.memories {
            transaction.execute(
                "INSERT INTO memory_records
                 (id, session_id, source_message_id, assistant_message_id,
                  kind, content, evidence_quote, evidence_state, revision,
                  edited, deleted, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'user_reported',
                         1, 0, 0, ?8, ?8)",
                params![
                    Uuid::new_v4().to_string(),
                    user.session_id,
                    user.id,
                    assistant_id,
                    candidate.kind.as_db_value(),
                    candidate.content,
                    candidate.evidence_quote,
                    timestamp,
                ],
            )?;
        }
        for candidate in &patch.notes {
            transaction.execute(
                "INSERT INTO user_notes
                 (id, session_id, source_message_id, kind, content,
                  evidence_quote, revision, edited, deleted, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, 0, ?7, ?7)",
                params![
                    Uuid::new_v4().to_string(),
                    user.session_id,
                    user.id,
                    candidate.kind.as_db_value(),
                    candidate.content,
                    candidate.evidence_quote,
                    timestamp,
                ],
            )?;
        }
        let changed = transaction.execute(
            "UPDATE notes_jobs
             SET status = 'complete', updated_at = ?1
             WHERE assistant_message_id = ?2 AND status = 'running'",
            params![timestamp, assistant_id],
        )?;
        if changed != 1 {
            return Err(VaultError::NotesJobAlreadyRunning);
        }
        transaction.commit()?;
        Ok(())
    }

    /// Build a bounded retrieval bundle from source-backed internal memory.
    /// Only records whose exact evidence is still a persisted user message are
    /// considered, and the output carries its evidence state so corrections
    /// are distinguishable from fresh model extraction.
    pub fn memory_context(&self, limit_bytes: usize) -> Result<String> {
        if limit_bytes == 0 {
            return Ok(String::new());
        }
        let mut statement = self.connection.prepare(
            "SELECT memory_records.kind, memory_records.content,
                    memory_records.evidence_quote, memory_records.evidence_state
             FROM memory_records
             JOIN messages ON messages.id = memory_records.source_message_id
             WHERE messages.role = 'user'
               AND memory_records.deleted = 0
               AND NOT EXISTS (
                   SELECT 1 FROM memory_exclusions
                   WHERE memory_exclusions.source_message_id = memory_records.source_message_id
               )
             ORDER BY CASE memory_records.evidence_state
                          WHEN 'user_confirmed' THEN 0
                          ELSE 1
                      END,
                      memory_records.updated_at DESC, memory_records.rowid DESC",
        )?;
        let mut rows = statement.query([])?;
        let mut context = String::new();
        while let Some(row) = rows.next()? {
            let kind_value: String = row.get(0)?;
            let kind =
                MemoryKind::from_db_value(&kind_value).ok_or(rusqlite::Error::InvalidQuery)?;
            let content: String = row.get(1)?;
            let evidence_quote: String = row.get(2)?;
            let evidence_state_value: String = row.get(3)?;
            let evidence_state = MemoryEvidenceState::from_db_value(&evidence_state_value)
                .ok_or(rusqlite::Error::InvalidQuery)?;
            let line = memory_context_line(kind, evidence_state, &content, &evidence_quote);
            if line.len() > limit_bytes.saturating_sub(context.len()) {
                break;
            }
            context.push_str(&line);
        }
        Ok(context)
    }

    pub fn append_user_message(&mut self, session_id: &str, content: &str) -> Result<Message> {
        let session_id = canonical_id(session_id, "session ID")?;
        validate_text(content, MAX_USER_MESSAGE_CHARS, "user message")?;

        let message = new_user_message(&session_id, content);
        let transaction = self.connection.transaction()?;
        ensure_session(&transaction, &session_id)?;
        insert_message(&transaction, &message)?;
        touch_session(&transaction, &session_id, &message.created_at)?;
        transaction.commit()?;
        Ok(message)
    }

    pub fn begin_turn(&mut self, session_id: &str, content: &str) -> Result<(Message, Message)> {
        let session_id = canonical_id(session_id, "session ID")?;
        validate_text(content, MAX_USER_MESSAGE_CHARS, "user message")?;

        let transaction = self.connection.transaction()?;
        ensure_session(&transaction, &session_id)?;
        ensure_no_active_assistant(&transaction, &session_id)?;

        let user = new_user_message(&session_id, content);
        let assistant = new_assistant_message(&session_id);
        insert_message(&transaction, &user)?;
        insert_message(&transaction, &assistant)?;
        insert_notes_job(&transaction, &assistant.id, &assistant.created_at)?;
        touch_session(&transaction, &session_id, &assistant.created_at)?;
        transaction.commit()?;
        Ok((user, assistant))
    }

    pub fn begin_assistant_message(&mut self, session_id: &str) -> Result<Message> {
        let session_id = canonical_id(session_id, "session ID")?;
        let transaction = self.connection.transaction()?;
        ensure_session(&transaction, &session_id)?;
        ensure_no_active_assistant(&transaction, &session_id)?;

        let message = new_assistant_message(&session_id);
        insert_message(&transaction, &message)?;
        touch_session(&transaction, &session_id, &message.created_at)?;
        transaction.commit()?;
        Ok(message)
    }

    pub fn append_assistant_chunk(&mut self, message_id: &str, chunk: &str) -> Result<Message> {
        if chunk.chars().count() > MAX_ASSISTANT_CHUNK_CHARS {
            return Err(VaultError::InvalidInput("assistant chunk is too long"));
        }

        let message_id = canonical_id(message_id, "message ID")?;
        let transaction = self.connection.transaction()?;
        let mut message = message_from_id(&transaction, &message_id)?;
        if message.role != MessageRole::Assistant {
            return Err(VaultError::InvalidMessageRole);
        }
        if message.status != MessageStatus::Streaming {
            return Err(VaultError::MessageNotStreaming);
        }

        let new_length = message.content.chars().count() + chunk.chars().count();
        if new_length > MAX_ASSISTANT_MESSAGE_CHARS {
            return Err(VaultError::InvalidInput("assistant message is too long"));
        }
        message.content.push_str(chunk);
        transaction.execute(
            "UPDATE messages SET content = ?1 WHERE id = ?2 AND status = 'streaming'",
            params![message.content, message_id],
        )?;
        transaction.commit()?;
        Ok(message)
    }

    pub fn finish_assistant_message(
        &mut self,
        message_id: &str,
        status: MessageStatus,
    ) -> Result<Message> {
        if !status.is_terminal() {
            return Err(VaultError::InvalidMessageStatus);
        }

        let message_id = canonical_id(message_id, "message ID")?;
        let transaction = self.connection.transaction()?;
        let mut message = message_from_id(&transaction, &message_id)?;
        if message.role != MessageRole::Assistant {
            return Err(VaultError::InvalidMessageRole);
        }
        if message.status != MessageStatus::Streaming {
            return Err(VaultError::MessageNotStreaming);
        }

        message.status = status;
        let timestamp = now_rfc3339();
        transaction.execute(
            "UPDATE messages SET status = ?1 WHERE id = ?2 AND status = 'streaming'",
            params![status.as_db_value(), message_id],
        )?;
        if status == MessageStatus::Interrupted {
            transaction.execute(
                "UPDATE notes_jobs
                 SET status = 'failed', updated_at = ?1
                 WHERE assistant_message_id = ?2 AND status IN ('pending', 'running')",
                params![timestamp, message_id],
            )?;
        }
        touch_session(&transaction, &message.session_id, &timestamp)?;
        transaction.commit()?;
        Ok(message)
    }
}

fn random_key() -> Zeroizing<[u8; DB_KEY_LENGTH]> {
    let mut key = Zeroizing::new([0u8; DB_KEY_LENGTH]);
    OsRng.fill_bytes(&mut *key);
    key
}

fn validate_passphrase(passphrase: &str) -> Result<()> {
    if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
        return Err(VaultError::InvalidInput("passphrase is too short"));
    }
    if passphrase.len() > MAX_PASSPHRASE_BYTES {
        return Err(VaultError::InvalidInput("passphrase is too long"));
    }
    Ok(())
}

fn validate_text(value: &str, max_chars: usize, field: &'static str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(VaultError::InvalidInput(field));
    }
    if value.chars().count() > max_chars {
        return Err(VaultError::InvalidInput(field));
    }
    Ok(())
}

fn canonical_id(value: &str, field: &'static str) -> Result<String> {
    if value.len() > 64 {
        return Err(VaultError::InvalidInput(field));
    }
    Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| VaultError::InvalidInput(field))
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn new_user_message(session_id: &str, content: &str) -> Message {
    Message {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.to_owned(),
        role: MessageRole::User,
        content: content.to_owned(),
        status: MessageStatus::Complete,
        created_at: now_rfc3339(),
    }
}

fn new_assistant_message(session_id: &str) -> Message {
    Message {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.to_owned(),
        role: MessageRole::Assistant,
        content: String::new(),
        status: MessageStatus::Streaming,
        created_at: now_rfc3339(),
    }
}

fn session_from_row(row: &Row<'_>) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

fn message_from_row(row: &Row<'_>) -> rusqlite::Result<Message> {
    let role_value: String = row.get(2)?;
    let status_value: String = row.get(4)?;
    let role = MessageRole::from_db_value(&role_value).ok_or(rusqlite::Error::InvalidQuery)?;
    let status =
        MessageStatus::from_db_value(&status_value).ok_or(rusqlite::Error::InvalidQuery)?;
    Ok(Message {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role,
        content: row.get(3)?,
        status,
        created_at: row.get(5)?,
    })
}

fn message_from_id(transaction: &Transaction<'_>, message_id: &str) -> Result<Message> {
    transaction
        .query_row(
            "SELECT id, session_id, role, content, status, created_at
             FROM messages WHERE id = ?1",
            [message_id],
            message_from_row,
        )
        .optional()?
        .ok_or(VaultError::MessageNotFound)
}

fn source_user_message(transaction: &Transaction<'_>, assistant: &Message) -> Result<Message> {
    transaction
        .query_row(
            "SELECT user_message.id, user_message.session_id, user_message.role,
                    user_message.content, user_message.status, user_message.created_at
             FROM messages AS user_message
             JOIN messages AS assistant_message
               ON assistant_message.session_id = user_message.session_id
             WHERE assistant_message.id = ?1
               AND user_message.role = 'user'
               AND user_message.rowid < assistant_message.rowid
             ORDER BY user_message.rowid DESC
             LIMIT 1",
            [&assistant.id],
            message_from_row,
        )
        .optional()?
        .ok_or(VaultError::NotesSourceNotFound)
}

fn insert_notes_job(
    transaction: &Transaction<'_>,
    assistant_id: &str,
    timestamp: &str,
) -> Result<()> {
    transaction.execute(
        "INSERT INTO notes_jobs
         (assistant_message_id, status, created_at, updated_at)
         VALUES (?1, 'pending', ?2, ?2)",
        params![assistant_id, timestamp],
    )?;
    Ok(())
}

struct StoredUserNote {
    note: UserNote,
    deleted: bool,
}

struct StoredMemoryRecord {
    memory: MemoryRecord,
    deleted: bool,
}

fn memory_record_from_row(row: &Row<'_>) -> rusqlite::Result<MemoryRecord> {
    let kind_value: String = row.get(4)?;
    let kind = MemoryKind::from_db_value(&kind_value).ok_or(rusqlite::Error::InvalidQuery)?;
    let evidence_state_value: String = row.get(7)?;
    let evidence_state = MemoryEvidenceState::from_db_value(&evidence_state_value)
        .ok_or(rusqlite::Error::InvalidQuery)?;
    let edited: i64 = row.get(9)?;
    if !matches!(edited, 0 | 1) {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(MemoryRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        source_message_id: row.get(2)?,
        assistant_message_id: row.get(3)?,
        kind,
        content: row.get(5)?,
        evidence_quote: row.get(6)?,
        evidence_state,
        revision: row.get(8)?,
        edited: edited == 1,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn memory_with_deleted_from_id(
    transaction: &Transaction<'_>,
    memory_id: &str,
) -> Result<StoredMemoryRecord> {
    transaction
        .query_row(
            "SELECT id, session_id, source_message_id, assistant_message_id,
                    kind, content, evidence_quote, evidence_state, revision,
                    edited, created_at, updated_at, deleted
             FROM memory_records WHERE id = ?1",
            [memory_id],
            |row| {
                let memory = memory_record_from_row(row)?;
                let deleted: i64 = row.get(12)?;
                if !matches!(deleted, 0 | 1) {
                    return Err(rusqlite::Error::InvalidQuery);
                }
                Ok(StoredMemoryRecord {
                    memory,
                    deleted: deleted == 1,
                })
            },
        )
        .optional()?
        .ok_or(VaultError::MemoryNotFound)
}

fn memory_source_is_excluded(
    transaction: &Transaction<'_>,
    source_message_id: &str,
) -> Result<bool> {
    let excluded: Option<i64> = transaction
        .query_row(
            "SELECT 1 FROM memory_exclusions WHERE source_message_id = ?1",
            [source_message_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(excluded.is_some())
}

fn user_note_from_row(row: &Row<'_>) -> rusqlite::Result<UserNote> {
    let kind_value: String = row.get(3)?;
    let kind = NoteKind::from_db_value(&kind_value).ok_or(rusqlite::Error::InvalidQuery)?;
    let edited: i64 = row.get(7)?;
    if !matches!(edited, 0 | 1) {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(UserNote {
        id: row.get(0)?,
        session_id: row.get(1)?,
        source_message_id: row.get(2)?,
        kind,
        content: row.get(4)?,
        evidence_quote: row.get(5)?,
        revision: row.get(6)?,
        edited: edited == 1,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn user_note_with_deleted_from_id(
    transaction: &Transaction<'_>,
    note_id: &str,
) -> Result<StoredUserNote> {
    transaction
        .query_row(
            "SELECT id, session_id, source_message_id, kind, content,
                    evidence_quote, revision, edited, created_at, updated_at, deleted
             FROM user_notes WHERE id = ?1",
            [note_id],
            |row| {
                let note = user_note_from_row(row)?;
                let deleted: i64 = row.get(10)?;
                if !matches!(deleted, 0 | 1) {
                    return Err(rusqlite::Error::InvalidQuery);
                }
                Ok(StoredUserNote {
                    note,
                    deleted: deleted == 1,
                })
            },
        )
        .optional()?
        .ok_or(VaultError::NoteNotFound)
}

fn validate_revision(revision: i64) -> Result<()> {
    if revision < 1 {
        return Err(VaultError::InvalidInput("note revision"));
    }
    Ok(())
}

fn validate_patch_shape(patch: &NotePatch) -> Result<()> {
    patch
        .validate_shape()
        .map_err(|_| VaultError::InvalidNotesPatch)
}

fn validate_patch_evidence(patch: &NotePatch, source: &str) -> Result<()> {
    patch
        .validate_against_source(source)
        .map_err(|_| VaultError::InvalidNotesPatch)
}

fn memory_kind_label(kind: MemoryKind) -> &'static str {
    match kind {
        MemoryKind::Person => "person",
        MemoryKind::Event => "event",
        MemoryKind::Goal => "goal",
        MemoryKind::Preference => "preference",
        MemoryKind::Concern => "concern",
    }
}

fn memory_context_line(
    kind: MemoryKind,
    evidence_state: MemoryEvidenceState,
    content: &str,
    evidence_quote: &str,
) -> String {
    match evidence_state {
        MemoryEvidenceState::UserReported => format!(
            "[user-reported] {}: {} (evidence: \"{}\")\n",
            memory_kind_label(kind),
            content,
            evidence_quote
        ),
        MemoryEvidenceState::UserConfirmed => format!(
            "[user-corrected] {}: {} (original evidence: \"{}\")\n",
            memory_kind_label(kind),
            content,
            evidence_quote
        ),
        MemoryEvidenceState::Inferred => format!(
            "[inferred] {}: {} (evidence: \"{}\")\n",
            memory_kind_label(kind),
            content,
            evidence_quote
        ),
    }
}

fn insert_message(transaction: &Transaction<'_>, message: &Message) -> Result<()> {
    transaction.execute(
        "INSERT INTO messages (id, session_id, role, content, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            message.id,
            message.session_id,
            message.role.as_db_value(),
            message.content,
            message.status.as_db_value(),
            message.created_at,
        ],
    )?;
    Ok(())
}

fn ensure_session(connection: &Connection, session_id: &str) -> Result<()> {
    let exists: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM sessions WHERE id = ?1 LIMIT 1",
            [session_id],
            |row| row.get(0),
        )
        .optional()?;
    if exists.is_some() {
        Ok(())
    } else {
        Err(VaultError::SessionNotFound)
    }
}

fn ensure_no_active_assistant(connection: &Connection, session_id: &str) -> Result<()> {
    let active_reply: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM messages
             WHERE session_id = ?1 AND role = 'assistant' AND status = 'streaming'
             LIMIT 1",
            [session_id],
            |row| row.get(0),
        )
        .optional()?;
    if active_reply.is_some() {
        Err(VaultError::AssistantAlreadyStreaming)
    } else {
        Ok(())
    }
}

fn touch_session(connection: &Connection, session_id: &str, timestamp: &str) -> Result<()> {
    connection.execute(
        "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
        params![timestamp, session_id],
    )?;
    Ok(())
}

fn open_connection(
    path: &Path,
    db_key: &[u8; DB_KEY_LENGTH],
    initialize: bool,
) -> Result<Connection> {
    let connection = Connection::open(path).map_err(|_| VaultError::Database)?;
    configure_connection(&connection, db_key)?;
    if initialize {
        configure_storage(&connection)?;
        initialize_schema(&connection)?;
    } else {
        // Read and migrate the version before enabling WAL or changing any
        // durable rows. In particular, a future version must fail untouched.
        migrate_schema(&connection)?;
        validate_schema(&connection)?;
        configure_storage(&connection)?;
    }
    Ok(connection)
}

fn configure_connection(connection: &Connection, db_key: &[u8; DB_KEY_LENGTH]) -> Result<()> {
    let mut key_hex = Zeroizing::new(bytes_to_hex(db_key));
    let key_pragma = Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", *key_hex));
    key_hex.zeroize();
    connection
        .execute_batch(&key_pragma)
        .map_err(|_| VaultError::Database)?;

    let cipher_version: Option<String> = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .optional()
        .map_err(|_| VaultError::Database)?;
    if cipher_version.as_deref().unwrap_or_default().is_empty() {
        return Err(VaultError::EncryptionUnavailable);
    }

    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA temp_store = MEMORY;
             PRAGMA secure_delete = ON;",
        )
        .map_err(|_| VaultError::Database)?;
    Ok(())
}

fn configure_storage(connection: &Connection) -> Result<()> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;",
        )
        .map_err(|_| VaultError::Database)?;
    Ok(())
}

fn initialize_schema(connection: &Connection) -> Result<()> {
    let schema = format!(
        "CREATE TABLE sessions (
             id TEXT PRIMARY KEY NOT NULL,
             title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND {MAX_SESSION_TITLE_CHARS}),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );
         CREATE TABLE messages (
             id TEXT PRIMARY KEY NOT NULL,
             session_id TEXT NOT NULL,
             role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
             content TEXT NOT NULL CHECK (length(content) <= {MAX_ASSISTANT_MESSAGE_CHARS}),
             status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'interrupted')),
             created_at TEXT NOT NULL,
             FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
         );
         CREATE INDEX messages_session_created_idx
             ON messages (session_id, created_at, id);
         {notes_schema}
         PRAGMA user_version = {SCHEMA_VERSION};",
        notes_schema = notes_schema_sql(),
    );
    connection.execute_batch(&schema)?;
    Ok(())
}

fn notes_schema_sql() -> String {
    format!(
        "CREATE TABLE notes_jobs (
             assistant_message_id TEXT PRIMARY KEY NOT NULL,
             status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'failed')),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             FOREIGN KEY (assistant_message_id) REFERENCES messages(id) ON DELETE CASCADE
         );
         CREATE INDEX notes_jobs_status_idx ON notes_jobs (status, updated_at);
         CREATE TABLE user_notes (
             id TEXT PRIMARY KEY NOT NULL,
             session_id TEXT NOT NULL,
             source_message_id TEXT NOT NULL,
             kind TEXT NOT NULL CHECK (kind IN ('takeaway', 'question', 'next_step')),
             content TEXT NOT NULL CHECK (deleted = 1 OR length(content) BETWEEN 1 AND {MAX_CONTENT}),
             evidence_quote TEXT NOT NULL CHECK (deleted = 1 OR length(evidence_quote) BETWEEN 1 AND {MAX_QUOTE}),
             revision INTEGER NOT NULL CHECK (revision >= 1),
             edited INTEGER NOT NULL CHECK (edited IN (0, 1)),
             deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
             FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE CASCADE
         );
         CREATE INDEX user_notes_visible_idx
             ON user_notes (deleted, updated_at);
         {memory_schema}",
        MAX_CONTENT = MAX_CANDIDATE_CONTENT_CHARS,
        MAX_QUOTE = MAX_EVIDENCE_QUOTE_CHARS,
        memory_schema = memory_schema_sql(),
    )
}

fn memory_records_table_sql() -> String {
    format!(
        "CREATE TABLE memory_records (
             id TEXT PRIMARY KEY NOT NULL,
             session_id TEXT NOT NULL,
             source_message_id TEXT NOT NULL,
             assistant_message_id TEXT NOT NULL,
             kind TEXT NOT NULL CHECK (kind IN ('person', 'event', 'goal', 'preference', 'concern')),
             content TEXT NOT NULL CHECK (deleted = 1 OR length(content) BETWEEN 1 AND {MAX_CONTENT}),
             evidence_quote TEXT NOT NULL CHECK (deleted = 1 OR length(evidence_quote) BETWEEN 1 AND {MAX_QUOTE}),
             evidence_state TEXT NOT NULL CHECK (evidence_state IN ('user_reported', 'user_confirmed', 'inferred')),
             revision INTEGER NOT NULL CHECK (revision >= 1),
             edited INTEGER NOT NULL CHECK (edited IN (0, 1)),
             deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
             FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE CASCADE,
             FOREIGN KEY (assistant_message_id) REFERENCES messages(id) ON DELETE CASCADE
         );",
        MAX_CONTENT = MAX_CANDIDATE_CONTENT_CHARS,
        MAX_QUOTE = MAX_EVIDENCE_QUOTE_CHARS,
    )
}

fn memory_schema_sql() -> String {
    format!(
        "{memory_records}
         CREATE INDEX memory_records_context_idx
             ON memory_records (deleted, updated_at);
         CREATE TABLE memory_exclusions (
             source_message_id TEXT PRIMARY KEY NOT NULL,
             scope TEXT NOT NULL CHECK (scope = 'source_turn'),
             created_at TEXT NOT NULL,
             FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE CASCADE
         );
         CREATE INDEX memory_exclusions_scope_idx
             ON memory_exclusions (scope, created_at);",
        memory_records = memory_records_table_sql(),
    )
}

fn migrate_schema(connection: &Connection) -> Result<()> {
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| VaultError::CorruptDatabase)?;
    if version > SCHEMA_VERSION as i64 {
        return Err(VaultError::CorruptDatabase);
    }
    match version {
        1 => {
            let transaction = connection.unchecked_transaction()?;
            transaction.execute_batch(&notes_schema_sql())?;
            transaction.execute(
                "INSERT INTO notes_jobs
                 (assistant_message_id, status, created_at, updated_at)
                 SELECT id, 'pending', created_at, created_at
                 FROM messages
                 WHERE role = 'assistant' AND status = 'complete'",
                [],
            )?;
            transaction.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
            transaction.commit()?;
            Ok(())
        }
        2 => {
            let transaction = connection.unchecked_transaction()?;
            transaction.execute_batch(&format!(
                "DROP INDEX IF EXISTS memory_records_context_idx;
                     ALTER TABLE memory_records RENAME TO memory_records_v2;
                     {memory_records}
                     INSERT INTO memory_records
                         (id, session_id, source_message_id, assistant_message_id,
                          kind, content, evidence_quote, evidence_state, revision,
                          edited, deleted, created_at, updated_at)
                     SELECT id, session_id, source_message_id, assistant_message_id,
                            kind, content, evidence_quote, 'user_reported', 1,
                            0, 0, created_at, created_at
                     FROM memory_records_v2;
                     DROP TABLE memory_records_v2;
                     CREATE INDEX memory_records_context_idx
                         ON memory_records (deleted, updated_at);
                     CREATE TABLE memory_exclusions (
                         source_message_id TEXT PRIMARY KEY NOT NULL,
                         scope TEXT NOT NULL CHECK (scope = 'source_turn'),
                         created_at TEXT NOT NULL,
                         FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE CASCADE
                     );
                     CREATE INDEX memory_exclusions_scope_idx
                         ON memory_exclusions (scope, created_at);",
                memory_records = memory_records_table_sql(),
            ))?;
            transaction.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
            transaction.commit()?;
            Ok(())
        }
        version if version == SCHEMA_VERSION as i64 => Ok(()),
        _ => Err(VaultError::CorruptDatabase),
    }
}

fn finalize_new_database(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "PRAGMA wal_checkpoint(TRUNCATE);
         PRAGMA journal_mode = DELETE;",
    )?;
    Ok(())
}

fn validate_schema(connection: &Connection) -> Result<()> {
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| VaultError::CorruptDatabase)?;
    if version != SCHEMA_VERSION as i64 {
        return Err(VaultError::CorruptDatabase);
    }

    let table_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master
             WHERE type = 'table' AND name IN
                 ('sessions', 'messages', 'notes_jobs', 'user_notes', 'memory_records',
                  'memory_exclusions')",
            [],
            |row| row.get(0),
        )
        .map_err(|_| VaultError::CorruptDatabase)?;
    if table_count != 6 {
        return Err(VaultError::CorruptDatabase);
    }
    Ok(())
}

fn recover_interrupted(connection: &Connection) -> Result<()> {
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "UPDATE messages SET status = 'interrupted' WHERE status = 'streaming'",
        [],
    )?;
    transaction.execute(
        "UPDATE notes_jobs
         SET status = 'failed', updated_at = ?1
         WHERE status IN ('pending', 'running')",
        [now_rfc3339()],
    )?;
    transaction.commit()?;
    Ok(())
}

fn derive_wrapping_key(
    passphrase: &str,
    salt: &[u8; ENVELOPE_SALT_LENGTH],
) -> Result<Zeroizing<[u8; DB_KEY_LENGTH]>> {
    let parameters = Params::new(
        KDF_MEMORY_KIB,
        KDF_TIME_COST,
        KDF_PARALLELISM,
        Some(DB_KEY_LENGTH),
    )
    .map_err(|_| VaultError::Crypto)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, parameters);
    let mut key = Zeroizing::new([0u8; DB_KEY_LENGTH]);
    argon
        .hash_password_into(passphrase.as_bytes(), salt, &mut *key)
        .map_err(|_| VaultError::Crypto)?;
    Ok(key)
}

fn encode_envelope(passphrase: &str, db_key: &[u8; DB_KEY_LENGTH]) -> Result<Vec<u8>> {
    let mut salt = [0u8; ENVELOPE_SALT_LENGTH];
    let mut nonce = [0u8; ENVELOPE_NONCE_LENGTH];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);

    let mut header = envelope_header(&salt, &nonce);
    let wrapping_key = derive_wrapping_key(passphrase, &salt)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&*wrapping_key));
    let encrypted_key = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: db_key,
                aad: &header,
            },
        )
        .map_err(|_| VaultError::Crypto)?;
    if encrypted_key.len() != DB_KEY_LENGTH + ENVELOPE_TAG_LENGTH {
        return Err(VaultError::Crypto);
    }
    header.extend_from_slice(&encrypted_key);
    Ok(header)
}

fn decode_envelope(passphrase: &str, path: &Path) -> Result<Zeroizing<[u8; DB_KEY_LENGTH]>> {
    let bytes = read_envelope(path)?;
    if bytes.len() != ENVELOPE_LENGTH || &bytes[..ENVELOPE_MAGIC.len()] != ENVELOPE_MAGIC {
        return Err(VaultError::CorruptEnvelope);
    }

    let version = bytes[8];
    let memory = u32::from_le_bytes(bytes[9..13].try_into().expect("fixed envelope header"));
    let time = u32::from_le_bytes(bytes[13..17].try_into().expect("fixed envelope header"));
    let parallelism = u32::from_le_bytes(bytes[17..21].try_into().expect("fixed envelope header"));
    if version != ENVELOPE_VERSION
        || memory != KDF_MEMORY_KIB
        || time != KDF_TIME_COST
        || parallelism != KDF_PARALLELISM
    {
        return Err(VaultError::CorruptEnvelope);
    }

    let mut salt = [0u8; ENVELOPE_SALT_LENGTH];
    salt.copy_from_slice(&bytes[21..37]);
    let mut nonce = [0u8; ENVELOPE_NONCE_LENGTH];
    nonce.copy_from_slice(&bytes[37..61]);
    let header = &bytes[..ENVELOPE_HEADER_LENGTH];
    let ciphertext = &bytes[ENVELOPE_HEADER_LENGTH..];

    let wrapping_key = derive_wrapping_key(passphrase, &salt)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&*wrapping_key));
    let mut plaintext = cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: ciphertext,
                aad: header,
            },
        )
        .map_err(|_| VaultError::InvalidPassphrase)?;
    if plaintext.len() != DB_KEY_LENGTH {
        plaintext.zeroize();
        return Err(VaultError::CorruptEnvelope);
    }

    let mut db_key = Zeroizing::new([0u8; DB_KEY_LENGTH]);
    db_key.copy_from_slice(&plaintext);
    plaintext.zeroize();
    Ok(db_key)
}

fn envelope_header(
    salt: &[u8; ENVELOPE_SALT_LENGTH],
    nonce: &[u8; ENVELOPE_NONCE_LENGTH],
) -> Vec<u8> {
    let mut header = Vec::with_capacity(ENVELOPE_HEADER_LENGTH);
    header.extend_from_slice(ENVELOPE_MAGIC);
    header.push(ENVELOPE_VERSION);
    header.extend_from_slice(&KDF_MEMORY_KIB.to_le_bytes());
    header.extend_from_slice(&KDF_TIME_COST.to_le_bytes());
    header.extend_from_slice(&KDF_PARALLELISM.to_le_bytes());
    header.extend_from_slice(salt);
    header.extend_from_slice(nonce);
    header
}

fn read_envelope(path: &Path) -> Result<Vec<u8>> {
    let file = File::open(path)?;
    let length = file.metadata()?.len();
    if length != ENVELOPE_LENGTH as u64 {
        return Err(VaultError::CorruptEnvelope);
    }
    let mut bytes = vec![0u8; ENVELOPE_LENGTH];
    let mut file = file;
    file.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn has_sqlite_header(path: &Path) -> Result<bool> {
    let mut file = File::open(path)?;
    let mut marker = [0u8; 16];
    let bytes_read = file.read(&mut marker)?;
    Ok(bytes_read == marker.len() && marker == *b"SQLite format 3\0")
}

fn temporary_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("vault.db");
    path.with_file_name(format!(".{file_name}.{}.tmp", Uuid::new_v4()))
}

fn acquire_lock(dir: &Path) -> Result<File> {
    let lock_path = dir.join(LOCK_FILE_NAME);
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)?;
    file.try_lock_exclusive().map_err(|_| VaultError::Io)?;
    Ok(file)
}

fn rename_new(source: &Path, destination: &Path) -> Result<()> {
    if destination.exists() {
        return Err(VaultError::VaultExists);
    }
    fs::rename(source, destination)?;
    let _ = sync_parent(destination.parent());
    Ok(())
}

fn atomic_write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or(VaultError::InvalidInput("vault path has no parent"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(VaultError::InvalidInput("vault file name is invalid"))?;
    let temporary = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));

    let write_result = (|| -> Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if path.exists() {
            return Err(VaultError::VaultExists);
        }
        fs::rename(&temporary, path)?;
        let _ = sync_parent(Some(parent));
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

fn sync_parent(parent: Option<&Path>) -> Result<()> {
    #[cfg(unix)]
    {
        if let Some(parent) = parent {
            File::open(parent)?.sync_all()?;
        }
    }
    #[cfg(not(unix))]
    let _ = parent;
    Ok(())
}

fn cleanup_sqlite_files(path: &Path) {
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(sidecar_path(path, "-wal"));
    let _ = fs::remove_file(sidecar_path(path, "-shm"));
    let _ = fs::remove_file(sidecar_path(path, "-journal"));
}

fn sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{}", path.display(), suffix))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes::{MemoryCandidate, MemoryEvidenceState, NoteCandidate};
    use std::fs;

    fn temp_vault_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("temporary test directory")
    }

    #[test]
    fn creates_and_reopens_with_encrypted_storage() {
        let directory = temp_vault_dir();
        let passphrase = "synthetic passphrase";
        let mut vault = Vault::create(directory.path(), passphrase).expect("create vault");
        let session = vault.create_session().expect("create session");
        let user = vault
            .append_user_message(&session.id, "I moved recently and miss my friends.")
            .expect("append user message");
        assert_eq!(user.role, MessageRole::User);
        drop(vault);

        let database_path = directory.path().join(DATABASE_FILE_NAME);
        let database_bytes = fs::read(&database_path).expect("read database bytes");
        assert!(!database_bytes.starts_with(b"SQLite format 3\0"));
        assert!(!database_bytes
            .windows("I moved recently and miss my friends.".len())
            .any(|window| window == b"I moved recently and miss my friends."));
        for suffix in ["-wal", "-shm", "-journal"] {
            let sidecar = PathBuf::from(format!("{}{}", database_path.display(), suffix));
            if let Ok(bytes) = fs::read(sidecar) {
                assert!(!bytes
                    .windows("I moved recently and miss my friends.".len())
                    .any(|window| window == b"I moved recently and miss my friends."));
            }
        }

        let reopened = Vault::open(directory.path(), passphrase).expect("reopen vault");
        let cipher_version: String = reopened
            .connection
            .query_row("PRAGMA cipher_version", [], |row| row.get(0))
            .expect("SQLCipher version");
        assert!(!cipher_version.is_empty());
        let messages = reopened.list_messages(&session.id).expect("list messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "I moved recently and miss my friends.");
    }

    #[test]
    fn wrong_passphrase_does_not_touch_database() {
        let directory = temp_vault_dir();
        let passphrase = "synthetic passphrase";
        let mut vault = Vault::create(directory.path(), passphrase).expect("create vault");
        let session = vault.create_session().expect("create session");
        vault
            .append_user_message(&session.id, "Synthetic marker for wrong key test.")
            .expect("append user message");
        drop(vault);
        let before = fs::read(directory.path().join(DATABASE_FILE_NAME)).expect("read database");

        let error = match Vault::open(directory.path(), "different passphrase") {
            Ok(_) => panic!("wrong passphrase unexpectedly unlocked vault"),
            Err(error) => error,
        };
        assert!(matches!(error, VaultError::InvalidPassphrase));
        let after = fs::read(directory.path().join(DATABASE_FILE_NAME)).expect("read database");
        assert_eq!(before, after);
    }

    #[test]
    fn refuses_overwrite_and_recovers_streaming_messages_on_unlock() {
        let directory = temp_vault_dir();
        let passphrase = "synthetic passphrase";
        let mut vault = Vault::create(directory.path(), passphrase).expect("create vault");
        let session = vault.create_session().expect("create session");
        let assistant = vault
            .begin_assistant_message(&session.id)
            .expect("begin assistant message");
        vault
            .append_assistant_chunk(&assistant.id, "A partial synthetic reply")
            .expect("append assistant chunk");
        drop(vault);

        let error = match Vault::create(directory.path(), passphrase) {
            Ok(_) => panic!("create unexpectedly overwrote vault"),
            Err(error) => error,
        };
        assert!(matches!(error, VaultError::VaultExists));

        let reopened = Vault::open(directory.path(), passphrase).expect("reopen vault");
        let messages = reopened.list_messages(&session.id).expect("list messages");
        assert_eq!(messages[0].status, MessageStatus::Interrupted);
        assert_eq!(messages[0].content, "A partial synthetic reply");
    }

    #[test]
    fn begin_turn_is_atomic_and_refuses_a_second_active_reply() {
        let directory = temp_vault_dir();
        let mut vault =
            Vault::create(directory.path(), "synthetic passphrase").expect("create vault");
        let session = vault.create_session().expect("create session");

        vault
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_assistant_insert
                 BEFORE INSERT ON messages
                 WHEN NEW.role = 'assistant'
                 BEGIN
                     SELECT RAISE(ABORT, 'synthetic trigger rejection');
                 END;",
            )
            .expect("install synthetic rollback trigger");
        let error = match vault.begin_turn(&session.id, "Synthetic atomic turn") {
            Ok(_) => panic!("assistant trigger did not abort the transaction"),
            Err(error) => error,
        };
        assert!(matches!(error, VaultError::Database));
        assert!(vault
            .list_messages(&session.id)
            .expect("list messages after rollback")
            .is_empty());

        vault
            .connection
            .execute_batch("DROP TRIGGER reject_assistant_insert")
            .expect("remove synthetic rollback trigger");
        let (user, assistant) = vault
            .begin_turn(&session.id, "Synthetic successful turn")
            .expect("begin turn");
        assert_eq!(user.role, MessageRole::User);
        assert_eq!(assistant.role, MessageRole::Assistant);
        assert_eq!(assistant.status, MessageStatus::Streaming);

        let error = match vault.begin_turn(&session.id, "Synthetic second turn") {
            Ok(_) => panic!("active assistant did not block another turn"),
            Err(error) => error,
        };
        assert!(matches!(error, VaultError::AssistantAlreadyStreaming));
        assert_eq!(
            vault
                .list_messages(&session.id)
                .expect("list messages")
                .len(),
            2
        );
    }

    #[test]
    fn exclusive_lock_blocks_a_second_unlock_until_drop() {
        let directory = temp_vault_dir();
        let vault = Vault::create(directory.path(), "synthetic passphrase").expect("create vault");

        let error = match Vault::open(directory.path(), "synthetic passphrase") {
            Ok(_) => panic!("second unlock unexpectedly acquired the vault lock"),
            Err(error) => error,
        };
        assert!(matches!(error, VaultError::Io));

        drop(vault);
        Vault::open(directory.path(), "synthetic passphrase").expect("unlock after drop");
    }

    #[test]
    fn rejects_cross_session_and_invalid_input_references() {
        let directory = temp_vault_dir();
        let mut vault =
            Vault::create(directory.path(), "synthetic passphrase").expect("create vault");
        let first = vault.create_session().expect("first session");
        let second = vault.create_session().expect("second session");
        vault
            .append_user_message(&first.id, "Synthetic first session message.")
            .expect("append message");

        assert!(matches!(
            vault.list_messages(&second.id),
            Ok(messages) if messages.is_empty()
        ));
        assert!(matches!(
            vault.append_user_message(&Uuid::new_v4().to_string(), "orphan"),
            Err(VaultError::SessionNotFound)
        ));
        assert!(matches!(
            vault.append_user_message(&first.id, "   "),
            Err(VaultError::InvalidInput(_))
        ));
        let oversized = "x".repeat(MAX_USER_MESSAGE_CHARS + 1);
        assert!(matches!(
            vault.append_user_message(&first.id, &oversized),
            Err(VaultError::InvalidInput(_))
        ));
        assert!(matches!(
            vault.list_messages("not-a-uuid"),
            Err(VaultError::InvalidInput(_))
        ));
    }

    fn finish_synthetic_turn(
        vault: &mut Vault,
        session_id: &str,
        content: &str,
    ) -> (Message, Message) {
        let (user, assistant) = vault.begin_turn(session_id, content).expect("begin turn");
        vault
            .finish_assistant_message(&assistant.id, MessageStatus::Complete)
            .expect("finish assistant");
        (user, assistant)
    }

    fn synthetic_patch() -> NotePatch {
        NotePatch {
            memories: vec![MemoryCandidate {
                kind: MemoryKind::Goal,
                content: "Reconnect with friends".to_owned(),
                evidence_quote: "miss my friends".to_owned(),
            }],
            notes: vec![NoteCandidate {
                kind: NoteKind::Takeaway,
                content: "We discussed reconnecting with friends.".to_owned(),
                evidence_quote: "miss my friends".to_owned(),
            }],
        }
    }

    #[test]
    fn migrates_a_schema_one_vault_without_losing_messages() {
        let directory = temp_vault_dir();
        let mut vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        let session = vault.create_session().expect("session");
        vault
            .append_user_message(&session.id, "Synthetic legacy message.")
            .expect("legacy message");
        vault
            .connection
            .execute_batch(
                "DROP TABLE memory_records;
                 DROP TABLE memory_exclusions;
                 DROP TABLE user_notes;
                 DROP TABLE notes_jobs;
                 PRAGMA user_version = 1;",
            )
            .expect("make schema one fixture");
        drop(vault);

        let migrated = Vault::open(directory.path(), "synthetic passphrase").expect("migrate");
        let messages = migrated.list_messages(&session.id).expect("messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Synthetic legacy message.");
        let version: i64 = migrated
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("schema version");
        assert_eq!(version, 3);
        assert!(migrated.list_notes().expect("notes").is_empty());
    }

    #[test]
    fn migrates_schema_two_memory_rows_with_safe_defaults() {
        let directory = temp_vault_dir();
        let mut vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        let session = vault.create_session().expect("session");
        let (user, assistant) = finish_synthetic_turn(
            &mut vault,
            &session.id,
            "I want to reconnect with a synthetic friend.",
        );
        vault
            .connection
            .execute_batch(
                "DROP TABLE memory_exclusions;
                 DROP TABLE memory_records;
                 CREATE TABLE memory_records (
                     id TEXT PRIMARY KEY NOT NULL,
                     session_id TEXT NOT NULL,
                     source_message_id TEXT NOT NULL,
                     assistant_message_id TEXT NOT NULL,
                     kind TEXT NOT NULL CHECK (kind IN ('person', 'event', 'goal', 'preference', 'concern')),
                     content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 600),
                     evidence_quote TEXT NOT NULL CHECK (length(evidence_quote) BETWEEN 1 AND 600),
                     created_at TEXT NOT NULL,
                     FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                     FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE CASCADE,
                     FOREIGN KEY (assistant_message_id) REFERENCES messages(id) ON DELETE CASCADE
                 );
                 CREATE INDEX memory_records_context_idx ON memory_records (created_at);
                 PRAGMA user_version = 2;",
            )
            .expect("make schema two fixture");
        let memory_id = Uuid::new_v4().to_string();
        vault
            .connection
            .execute(
                "INSERT INTO memory_records
                 (id, session_id, source_message_id, assistant_message_id,
                  kind, content, evidence_quote, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'goal', ?5, ?6, ?7)",
                params![
                    memory_id,
                    session.id,
                    user.id,
                    assistant.id,
                    "Reconnect with a synthetic friend",
                    "reconnect with a synthetic friend",
                    now_rfc3339(),
                ],
            )
            .expect("legacy memory row");
        drop(vault);

        let mut migrated = Vault::open(directory.path(), "synthetic passphrase").expect("migrate");
        let memory = migrated
            .list_memories()
            .expect("migrated memories")
            .pop()
            .expect("migrated memory");
        assert_eq!(memory.id, memory_id);
        assert_eq!(memory.revision, 1);
        assert!(!memory.edited);
        assert_eq!(memory.evidence_state, MemoryEvidenceState::UserReported);
        assert_eq!(memory.updated_at, memory.created_at);
        migrated
            .delete_memory(&memory.id, memory.revision)
            .expect("forget migrated memory");
        assert!(migrated
            .list_memories()
            .expect("forgotten memories")
            .is_empty());
        let tombstone: (i64, String, String) = migrated
            .connection
            .query_row(
                "SELECT deleted, content, evidence_quote
                 FROM memory_records WHERE id = ?1",
                [&memory.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("migrated tombstone");
        assert_eq!(tombstone.0, 1);
        assert!(tombstone.1.is_empty());
        assert!(tombstone.2.is_empty());
        let version: i64 = migrated
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("schema version");
        assert_eq!(version, 3);
    }

    #[test]
    fn migration_backfills_pending_jobs_for_completed_legacy_assistants() {
        let directory = temp_vault_dir();
        let mut vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        let session = vault.create_session().expect("session");
        let (_, assistant) = finish_synthetic_turn(
            &mut vault,
            &session.id,
            "A synthetic completed legacy turn.",
        );
        vault
            .connection
            .execute_batch(
                "DROP TABLE memory_records;
                 DROP TABLE memory_exclusions;
                 DROP TABLE user_notes;
                 DROP TABLE notes_jobs;
                 PRAGMA user_version = 1;",
            )
            .expect("make schema one fixture");
        drop(vault);

        let mut migrated = Vault::open(directory.path(), "synthetic passphrase").expect("migrate");
        let status: String = migrated
            .connection
            .query_row(
                "SELECT status FROM notes_jobs WHERE assistant_message_id = ?1",
                [&assistant.id],
                |row| row.get(0),
            )
            .expect("backfilled job");
        // Opening performs restart recovery after the migration, so the
        // backfilled pending job is explicitly retryable as failed.
        assert_eq!(status, "failed");
        let input = migrated.begin_notes(&assistant.id).expect("claim backfill");
        assert_eq!(input.assistant.id, assistant.id);
    }

    #[test]
    fn future_schema_version_is_rejected_before_migration() {
        let directory = temp_vault_dir();
        let vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        vault
            .connection
            .execute_batch("PRAGMA user_version = 77;")
            .expect("future version");
        drop(vault);

        assert!(matches!(
            Vault::open(directory.path(), "synthetic passphrase"),
            Err(VaultError::CorruptDatabase)
        ));
    }

    #[test]
    fn interrupting_assistant_fails_notes_job_in_the_same_transaction() {
        let directory = temp_vault_dir();
        let mut vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        let session = vault.create_session().expect("session");
        let (_, assistant) = vault
            .begin_turn(&session.id, "A synthetic interrupted turn.")
            .expect("begin turn");
        vault
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_notes_failure
                 BEFORE UPDATE ON notes_jobs
                 WHEN NEW.status = 'failed'
                 BEGIN
                     SELECT RAISE(ABORT, 'synthetic failure');
                 END;",
            )
            .expect("install rollback trigger");
        assert!(matches!(
            vault.finish_assistant_message(&assistant.id, MessageStatus::Interrupted),
            Err(VaultError::Database)
        ));
        assert_eq!(
            vault.list_messages(&session.id).expect("messages")[1].status,
            MessageStatus::Streaming
        );
        let status: String = vault
            .connection
            .query_row(
                "SELECT status FROM notes_jobs WHERE assistant_message_id = ?1",
                [&assistant.id],
                |row| row.get(0),
            )
            .expect("pending job");
        assert_eq!(status, "pending");

        vault
            .connection
            .execute_batch("DROP TRIGGER reject_notes_failure")
            .expect("remove rollback trigger");
        vault
            .finish_assistant_message(&assistant.id, MessageStatus::Interrupted)
            .expect("interrupt");
        let status: String = vault
            .connection
            .query_row(
                "SELECT status FROM notes_jobs WHERE assistant_message_id = ?1",
                [&assistant.id],
                |row| row.get(0),
            )
            .expect("failed job");
        assert_eq!(status, "failed");

        let (_, running_assistant) = vault
            .begin_turn(&session.id, "A second synthetic interrupted turn.")
            .expect("second turn");
        vault
            .connection
            .execute(
                "UPDATE notes_jobs SET status = 'running' WHERE assistant_message_id = ?1",
                [&running_assistant.id],
            )
            .expect("mark running");
        vault
            .finish_assistant_message(&running_assistant.id, MessageStatus::Interrupted)
            .expect("interrupt running job");
        let status: String = vault
            .connection
            .query_row(
                "SELECT status FROM notes_jobs WHERE assistant_message_id = ?1",
                [&running_assistant.id],
                |row| row.get(0),
            )
            .expect("failed running job");
        assert_eq!(status, "failed");
    }

    #[test]
    fn note_job_is_atomic_source_bound_and_idempotent() {
        let directory = temp_vault_dir();
        let mut vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        let session = vault.create_session().expect("session");
        let (user, assistant) = finish_synthetic_turn(
            &mut vault,
            &session.id,
            "I miss my friends and want to reconnect.",
        );
        let status: String = vault
            .connection
            .query_row(
                "SELECT status FROM notes_jobs WHERE assistant_message_id = ?1",
                [&assistant.id],
                |row| row.get(0),
            )
            .expect("pending job");
        assert_eq!(status, "pending");

        let input = vault.begin_notes(&assistant.id).expect("claim job");
        assert_eq!(input.user.id, user.id);
        assert_eq!(input.assistant.id, assistant.id);
        assert!(matches!(
            vault.begin_notes(&assistant.id),
            Err(VaultError::NotesJobAlreadyRunning)
        ));

        let mut invalid = synthetic_patch();
        invalid.notes[0].evidence_quote = "not in source".to_owned();
        assert!(matches!(
            vault.apply_notes(&assistant.id, &invalid),
            Err(VaultError::InvalidNotesPatch)
        ));
        let memory_count: i64 = vault
            .connection
            .query_row("SELECT count(*) FROM memory_records", [], |row| row.get(0))
            .expect("memory count");
        let note_count: i64 = vault
            .connection
            .query_row("SELECT count(*) FROM user_notes", [], |row| row.get(0))
            .expect("note count");
        assert_eq!(memory_count, 0);
        assert_eq!(note_count, 0);

        vault.fail_notes(&assistant.id).expect("fail job");
        vault.begin_notes(&assistant.id).expect("retry claim");
        vault
            .apply_notes(&assistant.id, &synthetic_patch())
            .expect("apply patch");
        assert!(matches!(
            vault.apply_notes(&assistant.id, &synthetic_patch()),
            Err(VaultError::NotesAlreadyComplete)
        ));
        let notes = vault.list_notes().expect("list notes");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].source_message_id, user.id);
        let context = vault.memory_context(1_000).expect("memory context");
        assert!(context.contains("[user-reported] goal: Reconnect with friends"));
        assert!(context.contains("miss my friends"));
        assert!(context.len() <= 1_000);
    }

    #[test]
    fn note_revisions_and_tombstones_protect_user_edits() {
        let directory = temp_vault_dir();
        let mut vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        let session = vault.create_session().expect("session");
        let (_, assistant) = finish_synthetic_turn(
            &mut vault,
            &session.id,
            "I miss my friends and want to reconnect.",
        );
        vault.begin_notes(&assistant.id).expect("claim");
        vault
            .apply_notes(&assistant.id, &synthetic_patch())
            .expect("apply");
        let note = vault.list_notes().expect("list").pop().expect("note");
        let edited = vault
            .edit_note(&note.id, "User edited this synthetic takeaway.", 1)
            .expect("edit");
        assert_eq!(edited.revision, 2);
        assert!(edited.edited);
        assert!(matches!(
            vault.edit_note(&note.id, "stale synthetic edit", 1),
            Err(VaultError::RevisionConflict)
        ));
        vault.delete_note(&note.id, 2).expect("delete");
        assert!(vault.list_notes().expect("visible notes").is_empty());
        assert!(matches!(
            vault.edit_note(&note.id, "resurrection", 3),
            Err(VaultError::NoteDeleted)
        ));
        let (deleted, evidence): (i64, String) = vault
            .connection
            .query_row(
                "SELECT deleted, evidence_quote FROM user_notes WHERE id = ?1",
                [&note.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("tombstone");
        assert_eq!(deleted, 1);
        assert!(evidence.is_empty());
    }

    #[test]
    fn memory_records_preserve_provenance_corrections_and_restart() {
        let directory = temp_vault_dir();
        let mut vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        let session = vault.create_session().expect("session");
        let (user, assistant) = finish_synthetic_turn(
            &mut vault,
            &session.id,
            "I miss my friends and want to reconnect.",
        );
        vault.begin_notes(&assistant.id).expect("claim");
        vault
            .apply_notes(&assistant.id, &synthetic_patch())
            .expect("apply");

        let memory = vault
            .list_memories()
            .expect("list memories")
            .pop()
            .expect("memory");
        assert_eq!(memory.session_id, session.id);
        assert_eq!(memory.source_message_id, user.id);
        assert_eq!(memory.assistant_message_id, assistant.id);
        assert_eq!(memory.evidence_quote, "miss my friends");
        assert_eq!(memory.evidence_state, MemoryEvidenceState::UserReported);
        assert_eq!(memory.revision, 1);
        assert!(!memory.edited);

        let corrected = vault
            .edit_memory(&memory.id, "Reconnect with my sibling", memory.revision)
            .expect("correct memory");
        assert_eq!(corrected.content, "Reconnect with my sibling");
        assert_eq!(corrected.evidence_quote, memory.evidence_quote);
        assert_eq!(corrected.source_message_id, memory.source_message_id);
        assert_eq!(corrected.revision, 2);
        assert!(corrected.edited);
        assert_eq!(corrected.evidence_state, MemoryEvidenceState::UserConfirmed);
        assert!(matches!(
            vault.edit_memory(&memory.id, "stale correction", memory.revision),
            Err(VaultError::MemoryRevisionConflict)
        ));

        let context = vault.memory_context(1_000).expect("corrected context");
        assert!(context.contains("[user-corrected] goal: Reconnect with my sibling"));
        assert!(context.contains("original evidence: \"miss my friends\""));

        drop(vault);
        let reopened = Vault::open(directory.path(), "synthetic passphrase").expect("reopen");
        let persisted = reopened
            .list_memories()
            .expect("persisted memories")
            .pop()
            .expect("persisted memory");
        assert_eq!(persisted.content, corrected.content);
        assert_eq!(persisted.revision, 2);
        assert!(persisted.edited);
        assert_eq!(persisted.evidence_state, MemoryEvidenceState::UserConfirmed);
    }

    #[test]
    fn forgetting_memory_excludes_source_turn_and_blocks_derivation_retry() {
        let directory = temp_vault_dir();
        let mut vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        let session = vault.create_session().expect("session");
        let (user, assistant) = finish_synthetic_turn(
            &mut vault,
            &session.id,
            "I miss my friends and want to reconnect.",
        );
        vault.begin_notes(&assistant.id).expect("claim");
        vault
            .apply_notes(&assistant.id, &synthetic_patch())
            .expect("apply");
        let memory = vault
            .list_memories()
            .expect("list memories")
            .pop()
            .expect("memory");
        assert_eq!(vault.list_notes().expect("notes").len(), 1);
        assert!(vault
            .memory_context(1_000)
            .expect("context before forget")
            .contains("Reconnect with friends"));

        // Simulate a retry that has already loaded the source. The native
        // engine normally serializes this with the forget command, but the
        // vault transaction must also reject the stale result if the two
        // operations race at a lower boundary.
        vault
            .connection
            .execute(
                "UPDATE notes_jobs SET status = 'failed' WHERE assistant_message_id = ?1",
                [&assistant.id],
            )
            .expect("make retryable job");
        vault.begin_notes(&assistant.id).expect("start stale retry");
        vault
            .delete_memory(&memory.id, memory.revision)
            .expect("forget memory");
        assert!(matches!(
            vault.apply_notes(&assistant.id, &synthetic_patch()),
            Err(VaultError::MemorySourceForgotten)
        ));
        assert!(vault.list_memories().expect("visible memories").is_empty());
        assert!(vault.list_notes().expect("visible notes").is_empty());
        assert!(vault
            .memory_context(1_000)
            .expect("context after forget")
            .is_empty());
        let visible_context = vault
            .list_context_messages(&session.id)
            .expect("model context messages");
        assert!(visible_context.is_empty());
        assert_eq!(
            vault.list_messages(&session.id).expect("transcript").len(),
            2
        );
        assert!(matches!(
            vault.begin_notes(&assistant.id),
            Err(VaultError::MemorySourceForgotten)
        ));

        let (deleted, content, evidence, revision): (i64, String, String, i64) = vault
            .connection
            .query_row(
                "SELECT deleted, content, evidence_quote, revision
                 FROM memory_records WHERE id = ?1",
                [&memory.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("memory tombstone");
        assert_eq!(deleted, 1);
        assert!(content.is_empty());
        assert!(evidence.is_empty());
        assert_eq!(revision, 2);
        let exclusion_count: i64 = vault
            .connection
            .query_row(
                "SELECT count(*) FROM memory_exclusions WHERE source_message_id = ?1",
                [&user.id],
                |row| row.get(0),
            )
            .expect("source exclusion");
        assert_eq!(exclusion_count, 1);

        drop(vault);
        let mut reopened = Vault::open(directory.path(), "synthetic passphrase").expect("reopen");
        assert!(reopened
            .list_memories()
            .expect("reopened memories")
            .is_empty());
        assert!(reopened
            .memory_context(1_000)
            .expect("reopened context")
            .is_empty());
        assert!(matches!(
            reopened.begin_notes(&assistant.id),
            Err(VaultError::MemorySourceForgotten)
        ));
    }

    #[test]
    fn restart_fails_pending_notes_without_deleting_old_records() {
        let directory = temp_vault_dir();
        let mut vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        let session = vault.create_session().expect("session");
        let (_, assistant) = finish_synthetic_turn(
            &mut vault,
            &session.id,
            "I miss my friends and want to reconnect.",
        );
        vault.begin_notes(&assistant.id).expect("claim");
        drop(vault);

        let mut reopened = Vault::open(directory.path(), "synthetic passphrase").expect("open");
        let status: String = reopened
            .connection
            .query_row(
                "SELECT status FROM notes_jobs WHERE assistant_message_id = ?1",
                [&assistant.id],
                |row| row.get(0),
            )
            .expect("recovered job");
        assert_eq!(status, "failed");
        reopened
            .begin_notes(&assistant.id)
            .expect("retry after restart");
        assert!(reopened.list_notes().expect("old notes").is_empty());
    }

    #[test]
    fn deleting_session_cascades_its_encrypted_records() {
        let directory = temp_vault_dir();
        let mut vault = Vault::create(directory.path(), "synthetic passphrase").expect("create");
        let session = vault.create_session().expect("session");
        let (_, assistant) = finish_synthetic_turn(
            &mut vault,
            &session.id,
            "I miss my friends and want to reconnect.",
        );
        vault.begin_notes(&assistant.id).expect("claim");
        vault
            .apply_notes(&assistant.id, &synthetic_patch())
            .expect("apply");
        vault.delete_session(&session.id).expect("delete session");
        assert!(vault.list_sessions().expect("sessions").is_empty());
        for table in [
            "messages",
            "notes_jobs",
            "user_notes",
            "memory_records",
            "memory_exclusions",
        ] {
            let count: i64 = vault
                .connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("cascade count");
            assert_eq!(count, 0, "table {table} still has records");
        }
    }
}
