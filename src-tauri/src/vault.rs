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

pub const DATABASE_FILE_NAME: &str = "vault.db";
pub const ENVELOPE_FILE_NAME: &str = "vault.key";
pub const LOCK_FILE_NAME: &str = "vault.lock";

pub const MIN_PASSPHRASE_CHARS: usize = 12;
pub const MAX_PASSPHRASE_BYTES: usize = 1024;
pub const MAX_USER_MESSAGE_CHARS: usize = 32_000;
pub const MAX_ASSISTANT_CHUNK_CHARS: usize = 32_000;
pub const MAX_ASSISTANT_MESSAGE_CHARS: usize = 200_000;
pub const MAX_SESSION_TITLE_CHARS: usize = 120;

const SCHEMA_VERSION: i32 = 1;
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
        transaction.execute(
            "UPDATE messages SET status = ?1 WHERE id = ?2 AND status = 'streaming'",
            params![status.as_db_value(), message_id],
        )?;
        touch_session(&transaction, &message.session_id, &now_rfc3339())?;
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
         PRAGMA user_version = {SCHEMA_VERSION};"
    );
    connection.execute_batch(&schema)?;
    Ok(())
}

fn finalize_new_database(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "PRAGMA wal_checkpoint(TRUNCATE);
         PRAGMA journal_mode = DELETE;",
    )?;
    Ok(())
}

fn validate_schema(connection: &Connection) -> Result<()> {
    let version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| VaultError::CorruptDatabase)?;
    if version != SCHEMA_VERSION {
        return Err(VaultError::CorruptDatabase);
    }

    let table_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master
             WHERE type = 'table' AND name IN ('sessions', 'messages')",
            [],
            |row| row.get(0),
        )
        .map_err(|_| VaultError::CorruptDatabase)?;
    if table_count != 2 {
        return Err(VaultError::CorruptDatabase);
    }
    Ok(())
}

fn recover_interrupted(connection: &Connection) -> Result<()> {
    connection.execute(
        "UPDATE messages SET status = 'interrupted' WHERE status = 'streaming'",
        [],
    )?;
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
}
