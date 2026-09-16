use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    Key, XChaCha20Poly1305, XNonce,
};
use chrono::{SecondsFormat, Utc};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::vault::{
    Vault, DATABASE_FILE_NAME, ENVELOPE_FILE_NAME, KDF_MEMORY_KIB, KDF_PARALLELISM, KDF_TIME_COST,
};

const BACKUP_MAGIC: &[u8; 8] = b"OMBKP001";
const BACKUP_VERSION: u8 = 1;
const SALT_LENGTH: usize = 16;
const NONCE_LENGTH: usize = 24;
const HEADER_LENGTH: usize = 8 + 1 + SALT_LENGTH + NONCE_LENGTH + 8;
const MAX_BACKUP_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub created_at: String,
    pub sessions: u64,
    pub messages: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    format: u8,
    created_at: String,
    sessions: u64,
    messages: u64,
}

pub fn export_backup(
    vault: &Vault,
    destination: &Path,
    passphrase: &str,
) -> Result<BackupSummary, String> {
    let destination = validate_new_archive_path(destination)?;
    let parent = destination
        .parent()
        .ok_or("The backup path has no parent directory.")?;
    let snapshot = parent.join(format!(".openmind-snapshot-{}.db", Uuid::new_v4()));
    let result = (|| {
        let (envelope, sessions, messages) = vault
            .backup_parts(&snapshot, passphrase)
            .map_err(|error| error.to_string())?;
        let database = read_bounded(&snapshot)?;
        let summary = BackupSummary {
            created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            sessions,
            messages,
        };
        let manifest = BackupManifest {
            format: BACKUP_VERSION,
            created_at: summary.created_at.clone(),
            sessions,
            messages,
        };
        let manifest =
            serde_json::to_vec(&manifest).map_err(|_| "Could not encode the backup manifest.")?;
        let mut plaintext = Zeroizing::new(Vec::with_capacity(
            16 + manifest.len() + envelope.len() + database.len(),
        ));
        plaintext.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
        plaintext.extend_from_slice(&(envelope.len() as u32).to_le_bytes());
        plaintext.extend_from_slice(&(database.len() as u64).to_le_bytes());
        plaintext.extend_from_slice(&manifest);
        plaintext.extend_from_slice(&envelope);
        plaintext.extend_from_slice(&database);
        let archive = encrypt_archive(passphrase, &plaintext)?;
        atomic_write_new(&destination, &archive)?;
        Ok(summary)
    })();
    remove_file_if_present(&snapshot);
    result
}

pub fn stage_restore(
    source: &Path,
    vault_directory: &Path,
    passphrase: &str,
) -> Result<(PathBuf, BackupSummary), String> {
    let source = validate_existing_archive_path(source)?;
    let archive = read_bounded(&source)?;
    let plaintext = decrypt_archive(passphrase, &archive)?;
    let (manifest, envelope, database) = parse_payload(&plaintext)?;
    let parent = vault_directory
        .parent()
        .ok_or("The vault path has no parent directory.")?;
    fs::create_dir_all(parent).map_err(|_| "Could not prepare the vault directory.")?;
    let parent = parent
        .canonicalize()
        .map_err(|_| "Could not resolve the vault directory.")?;
    let staging = parent.join(format!(".openmind-restore-{}", Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|_| "Could not create restore staging.")?;
    let result = (|| {
        write_new(&staging.join(ENVELOPE_FILE_NAME), envelope)?;
        write_new(&staging.join(DATABASE_FILE_NAME), database)?;
        let verified = Vault::open(&staging, passphrase)
            .map_err(|error| format!("Backup verification failed: {error}"))?;
        drop(verified);
        Ok((
            staging.clone(),
            BackupSummary {
                created_at: manifest.created_at,
                sessions: manifest.sessions,
                messages: manifest.messages,
            },
        ))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn encrypt_archive(passphrase: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; SALT_LENGTH];
    let mut nonce = [0u8; NONCE_LENGTH];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let key = derive_key(passphrase, &salt)?;
    let mut header = Vec::with_capacity(HEADER_LENGTH);
    header.extend_from_slice(BACKUP_MAGIC);
    header.push(BACKUP_VERSION);
    header.extend_from_slice(&salt);
    header.extend_from_slice(&nonce);
    header.extend_from_slice(&((plaintext.len() + 16) as u64).to_le_bytes());
    let ciphertext = XChaCha20Poly1305::new(Key::from_slice(&*key))
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &header,
            },
        )
        .map_err(|_| "Could not encrypt the backup.")?;
    header.extend_from_slice(&ciphertext);
    Ok(header)
}

fn decrypt_archive(passphrase: &str, archive: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    if archive.len() < HEADER_LENGTH
        || &archive[..8] != BACKUP_MAGIC
        || archive[8] != BACKUP_VERSION
    {
        return Err("This is not a supported Openmind backup.".into());
    }
    let ciphertext_length =
        u64::from_le_bytes(archive[49..57].try_into().expect("fixed backup header"));
    if ciphertext_length > MAX_BACKUP_BYTES
        || ciphertext_length as usize != archive.len() - HEADER_LENGTH
    {
        return Err("The backup is corrupt or too large.".into());
    }
    let mut salt = [0u8; SALT_LENGTH];
    salt.copy_from_slice(&archive[9..25]);
    let mut nonce = [0u8; NONCE_LENGTH];
    nonce.copy_from_slice(&archive[25..49]);
    let key = derive_key(passphrase, &salt)?;
    let plaintext = XChaCha20Poly1305::new(Key::from_slice(&*key))
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &archive[HEADER_LENGTH..],
                aad: &archive[..HEADER_LENGTH],
            },
        )
        .map_err(|_| "The backup passphrase is wrong or the backup is corrupt.")?;
    Ok(Zeroizing::new(plaintext))
}

fn derive_key(passphrase: &str, salt: &[u8; SALT_LENGTH]) -> Result<Zeroizing<[u8; 32]>, String> {
    if passphrase.chars().count() < crate::vault::MIN_PASSPHRASE_CHARS
        || passphrase.len() > crate::vault::MAX_PASSPHRASE_BYTES
    {
        return Err("Use a backup passphrase between 12 characters and 1,024 UTF-8 bytes.".into());
    }
    let params = Params::new(KDF_MEMORY_KIB, KDF_TIME_COST, KDF_PARALLELISM, Some(32))
        .map_err(|_| "Could not configure backup encryption.")?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, &mut *key)
        .map_err(|_| "Could not derive the backup key.")?;
    Ok(key)
}

fn parse_payload(payload: &[u8]) -> Result<(BackupManifest, &[u8], &[u8]), String> {
    if payload.len() < 16 {
        return Err("The backup payload is corrupt.".into());
    }
    let manifest_len = u32::from_le_bytes(payload[0..4].try_into().unwrap()) as usize;
    let envelope_len = u32::from_le_bytes(payload[4..8].try_into().unwrap()) as usize;
    let database_len = u64::from_le_bytes(payload[8..16].try_into().unwrap()) as usize;
    let expected = 16usize
        .checked_add(manifest_len)
        .and_then(|v| v.checked_add(envelope_len))
        .and_then(|v| v.checked_add(database_len))
        .ok_or("The backup payload is corrupt.")?;
    if expected != payload.len() {
        return Err("The backup payload is corrupt.".into());
    }
    let manifest_end = 16 + manifest_len;
    let envelope_end = manifest_end + envelope_len;
    let manifest: BackupManifest = serde_json::from_slice(&payload[16..manifest_end])
        .map_err(|_| "The backup manifest is corrupt.")?;
    if manifest.format != BACKUP_VERSION {
        return Err("This backup version is not supported.".into());
    }
    Ok((
        manifest,
        &payload[manifest_end..envelope_end],
        &payload[envelope_end..],
    ))
}

fn validate_new_archive_path(path: &Path) -> Result<PathBuf, String> {
    if path.extension().and_then(|value| value.to_str()) != Some("openmind-backup") {
        return Err("Choose a file ending in .openmind-backup.".into());
    }
    if path.exists() {
        return Err("A backup already exists at that path.".into());
    }
    let parent = path
        .parent()
        .ok_or("The backup path has no parent directory.")?
        .canonicalize()
        .map_err(|_| "The backup folder does not exist.")?;
    Ok(parent.join(path.file_name().ok_or("The backup file name is invalid.")?))
}

fn validate_existing_archive_path(path: &Path) -> Result<PathBuf, String> {
    if path.extension().and_then(|value| value.to_str()) != Some("openmind-backup") {
        return Err("Choose an .openmind-backup file.".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| "The backup file was not found.")?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("The backup must be a regular file, not a link.".into());
    }
    path.canonicalize()
        .map_err(|_| "Could not resolve the backup file.".into())
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|_| "Could not read the backup data.")?;
    if metadata.len() > MAX_BACKUP_BYTES {
        return Err("The backup is too large.".into());
    }
    let file = File::open(path).map_err(|_| "Could not read the backup data.")?;
    read_limited(file, MAX_BACKUP_BYTES)
}

fn read_limited(reader: impl Read, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the backup data.")?;
    if bytes.len() as u64 > limit {
        return Err("The backup is too large.".into());
    }
    Ok(bytes)
}

fn atomic_write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_file_name(format!(".openmind-backup-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        write_new(&temporary, bytes)?;
        if path.exists() {
            return Err("A backup already exists at that path.".into());
        }
        fs::rename(&temporary, path).map_err(|_| "Could not finalize the backup.")?;
        Ok(())
    })();
    if result.is_err() {
        remove_file_if_present(&temporary);
    }
    result
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "Could not create the backup file.")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Could not write the backup file.".to_owned())
}

fn remove_file_if_present(path: &Path) {
    let _ = fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{models::MessageStatus, notes::NotePatch, vault::Vault};

    const VAULT_PASSPHRASE: &str = "synthetic original passphrase";
    const BACKUP_PASSPHRASE: &str = "synthetic portable backup passphrase";

    #[test]
    fn bounded_reader_rejects_content_that_grows_past_limit() {
        let error = read_limited(std::io::Cursor::new(b"12345"), 4).unwrap_err();
        assert_eq!(error, "The backup is too large.");
        assert_eq!(
            read_limited(std::io::Cursor::new(b"1234"), 4).unwrap(),
            b"1234"
        );
    }

    #[test]
    fn encrypted_backup_restores_and_rejects_wrong_password_and_corruption() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let mut vault = Vault::create(&source, VAULT_PASSPHRASE).unwrap();
        let session = vault
            .create_session_with_title("Synthetic recovery")
            .unwrap();
        vault
            .append_user_message(&session.id, "Synthetic canary: amber lighthouse.")
            .unwrap();
        let archive = root.path().join("portable.openmind-backup");
        let summary = export_backup(&vault, &archive, BACKUP_PASSPHRASE).unwrap();
        assert_eq!(summary.sessions, 1);
        assert_eq!(summary.messages, 1);
        drop(vault);

        let target = root.path().join("target");
        assert!(stage_restore(&archive, &target, "wrong synthetic backup passphrase").is_err());
        let (staging, restored_summary) =
            stage_restore(&archive, &target, BACKUP_PASSPHRASE).unwrap();
        assert_eq!(restored_summary.sessions, 1);
        let restored = Vault::open(&staging, BACKUP_PASSPHRASE).unwrap();
        assert_eq!(
            restored.list_messages(&session.id).unwrap()[0].content,
            "Synthetic canary: amber lighthouse."
        );
        drop(restored);
        fs::remove_dir_all(staging).unwrap();

        let mut corrupt = fs::read(&archive).unwrap();
        let last = corrupt.len() - 1;
        corrupt[last] ^= 0x80;
        let corrupt_path = root.path().join("corrupt.openmind-backup");
        fs::write(&corrupt_path, corrupt).unwrap();
        assert!(stage_restore(&corrupt_path, &target, BACKUP_PASSPHRASE).is_err());
    }

    #[test]
    fn backup_file_contains_no_plaintext_canary() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let mut vault = Vault::create(&source, VAULT_PASSPHRASE).unwrap();
        let session = vault.create_session().unwrap();
        let canary = "PRIVATE-SYNTHETIC-CANARY-4f091";
        vault.append_user_message(&session.id, canary).unwrap();
        let archive = root.path().join("opaque.openmind-backup");
        export_backup(&vault, &archive, BACKUP_PASSPHRASE).unwrap();
        assert!(!fs::read(archive)
            .unwrap()
            .windows(canary.len())
            .any(|window| window == canary.as_bytes()));
    }

    #[test]
    fn backup_preserves_forgotten_source_exclusions_without_recreating_derivatives() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let mut vault = Vault::create(&source, VAULT_PASSPHRASE).unwrap();
        let session = vault.create_session().unwrap();
        let (_, assistant) = vault
            .begin_turn(&session.id, "I want to reconnect with a synthetic friend.")
            .unwrap();
        vault
            .append_assistant_chunk(&assistant.id, "Synthetic reply.")
            .unwrap();
        vault
            .finish_assistant_message(&assistant.id, MessageStatus::Complete)
            .unwrap();
        vault.begin_notes(&assistant.id).unwrap();
        let patch: NotePatch = serde_json::from_value(serde_json::json!({
            "memories": [{"kind":"goal", "content":"Reconnect with a synthetic friend", "evidenceQuote":"reconnect with a synthetic friend"}],
            "notes": [{"kind":"next_step", "content":"Send a synthetic message", "evidenceQuote":"reconnect with a synthetic friend"}]
        })).unwrap();
        vault.apply_notes(&assistant.id, &patch).unwrap();
        let memory = vault.list_memories().unwrap().pop().unwrap();
        vault.delete_memory(&memory.id, memory.revision).unwrap();
        let archive = root.path().join("forgotten.openmind-backup");
        export_backup(&vault, &archive, BACKUP_PASSPHRASE).unwrap();
        drop(vault);

        let (staging, _) =
            stage_restore(&archive, &root.path().join("target"), BACKUP_PASSPHRASE).unwrap();
        let restored = Vault::open(&staging, BACKUP_PASSPHRASE).unwrap();
        assert!(restored
            .list_context_messages(&session.id)
            .unwrap()
            .is_empty());
        assert!(restored.list_memories().unwrap().is_empty());
        assert!(restored.list_notes().unwrap().is_empty());
        assert_eq!(restored.list_messages(&session.id).unwrap().len(), 2);
    }
}
