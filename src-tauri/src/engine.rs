use std::{path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::{
    models::{Message, MessageRole, MessageStatus, Session},
    notes::{MemoryRecord, NotePatch, NotesInput, UserNote},
    vault::Vault,
};

const CODEX_DEMO_ONLY_ERROR: &str = "ChatGPT via Codex is available only in the demo vault.";
const CODEX_CONSENT_REQUIRED_ERROR: &str =
    "Confirm remote processing consent before using ChatGPT via Codex.";
const DEMO_REQUIRED_ERROR: &str = "Open the demo vault before using ChatGPT via Codex.";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    #[default]
    Ollama,
    Codex,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TurnEvent {
    Message {
        message: Message,
    },
    #[serde(rename_all = "camelCase")]
    Chunk {
        message_id: String,
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    Finished {
        message_id: String,
        status: MessageStatus,
    },
    Error {
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Notes {
        message_id: String,
        status: NotesStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        memory_enabled: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        notes_enabled: Option<bool>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NotesStatus {
    Updating,
    Complete,
    Failed,
    Skipped,
}

pub const DEMO_ID: &str = "demo";
pub const DEMO_PASSPHRASE: &str = "openmind-demo-2026";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub exists: bool,
    pub unlocked: bool,
    pub is_demo: bool,
}

struct ActiveTurn {
    message_id: String,
    cancel: CancellationToken,
}

struct ActiveNotes {
    attempt_id: String,
    message_id: String,
    cancel: CancellationToken,
}

pub struct PreparedNotes {
    pub attempt_id: String,
    pub input: NotesInput,
    pub cancel: CancellationToken,
    /// Both branches were disabled for this source job, so no provider call
    /// is allowed and the job was completed without writing output.
    pub skipped: bool,
}

/// The durable reply status and the atomically reserved notes job, if any.
/// A notes-claim error is kept inside this result so a completed reply is
/// still handed to the UI and remains persisted.
pub struct FinishedTurn {
    pub status: MessageStatus,
    pub notes: Result<Option<PreparedNotes>, String>,
}

#[derive(Default)]
struct State {
    vault: Option<Vault>,
    active: Option<ActiveTurn>,
    notes_active: Option<ActiveNotes>,
    is_demo: bool,
}

pub struct Engine {
    directory: PathBuf,
    state: Mutex<State>,
}

pub struct PreparedTurn {
    pub user: Message,
    pub assistant: Message,
    pub history: Vec<Message>,
    pub memory: String,
    pub cancel: CancellationToken,
}

impl Engine {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            state: Mutex::new(State::default()),
        }
    }

    fn state(&self) -> Result<std::sync::MutexGuard<'_, State>, String> {
        self.state
            .lock()
            .map_err(|_| "The vault needs to be reopened. Restart Openmind.".into())
    }

    pub fn status(&self) -> Result<VaultStatus, String> {
        let state = self.state()?;
        Ok(VaultStatus {
            exists: Vault::exists(self.directory_for(state.is_demo)),
            unlocked: state.vault.is_some(),
            is_demo: state.is_demo,
        })
    }

    /// Called once when the renderer mounts; an old channel cannot be reattached.
    pub fn reconnect_renderer(&self) -> Result<VaultStatus, String> {
        let mut state = self.state()?;
        if let Some(active) = state.active.take() {
            active.cancel.cancel();
            state
                .vault
                .as_mut()
                .ok_or("The vault is locked.")?
                .finish_assistant_message(&active.message_id, MessageStatus::Interrupted)
                .map_err(|error| error.to_string())?;
        }
        if let Some(notes) = state.notes_active.take() {
            notes.cancel.cancel();
            if let Some(vault) = state.vault.as_mut() {
                vault
                    .fail_notes(&notes.message_id)
                    .map_err(|error| error.to_string())?;
            }
        }
        Ok(VaultStatus {
            exists: Vault::exists(self.directory_for(state.is_demo)),
            unlocked: state.vault.is_some(),
            is_demo: state.is_demo,
        })
    }

    fn directory_for(&self, is_demo: bool) -> PathBuf {
        if is_demo {
            self.directory.with_file_name("demo-vault")
        } else {
            self.directory.clone()
        }
    }

    pub fn open_demo(&self, login_id: &str, passphrase: &str) -> Result<VaultStatus, String> {
        if login_id != DEMO_ID || passphrase != DEMO_PASSPHRASE {
            return Err("Use demo and openmind-demo-2026 for the sample vault.".into());
        }
        let mut state = self.state()?;
        if state.vault.is_some() {
            return Err("Lock the current vault before opening the demo.".into());
        }
        let directory = self.directory_for(true);
        let mut vault = if Vault::exists(&directory) {
            Vault::open(&directory, DEMO_PASSPHRASE)
        } else {
            Vault::create(&directory, DEMO_PASSPHRASE)
        }
        .map_err(|error| error.to_string())?;
        seed_demo(&mut vault).map_err(|error| error.to_string())?;
        state.vault = Some(vault);
        state.is_demo = true;
        Ok(VaultStatus {
            exists: true,
            unlocked: true,
            is_demo: true,
        })
    }

    pub fn unlock(&self, passphrase: &str, create: bool) -> Result<(), String> {
        let mut state = self.state()?;
        if state.vault.is_some() {
            return Err("The vault is already unlocked.".into());
        }
        let vault = if create {
            Vault::create(&self.directory, passphrase)
        } else {
            Vault::open(&self.directory, passphrase)
        }
        .map_err(|error| error.to_string())?;
        state.vault = Some(vault);
        state.is_demo = false;
        Ok(())
    }

    pub fn lock(&self) -> Result<(), String> {
        let mut state = self.state()?;
        if let Some(active) = state.active.take() {
            active.cancel.cancel();
            if let Some(vault) = state.vault.as_mut() {
                let _ =
                    vault.finish_assistant_message(&active.message_id, MessageStatus::Interrupted);
            }
        }
        if let Some(notes) = state.notes_active.take() {
            notes.cancel.cancel();
            if let Some(vault) = state.vault.as_mut() {
                let _ = vault.fail_notes(&notes.message_id);
            }
        }
        state.is_demo = false;
        // Release the vault even if the final status could not be persisted.
        // Opening it again recovers unfinished messages as interrupted.
        state.vault.take();
        Ok(())
    }

    pub fn require_unlocked(&self) -> Result<(), String> {
        if self.state()?.vault.is_none() {
            return Err("Unlock your vault first.".into());
        }
        Ok(())
    }

    pub fn require_demo(&self) -> Result<(), String> {
        let state = self.state()?;
        if !state.is_demo {
            return Err(DEMO_REQUIRED_ERROR.into());
        }
        if state.vault.is_none() {
            return Err(DEMO_REQUIRED_ERROR.into());
        }
        Ok(())
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>, String> {
        self.state()?
            .vault
            .as_ref()
            .ok_or("Unlock your vault first.")?
            .list_sessions()
            .map_err(|error| error.to_string())
    }

    pub fn create_session(&self) -> Result<Session, String> {
        self.state()?
            .vault
            .as_mut()
            .ok_or("Unlock your vault first.")?
            .create_session()
            .map_err(|error| error.to_string())
    }

    pub fn update_session(
        &self,
        id: &str,
        title: &str,
        memory_enabled: bool,
        notes_enabled: bool,
        expected_revision: i64,
    ) -> Result<Session, String> {
        let mut state = self.state()?;
        if state.active.is_some() || state.notes_active.is_some() {
            return Err("Stop the current operation before changing conversation settings.".into());
        }
        state
            .vault
            .as_mut()
            .ok_or("Unlock your vault first.")?
            .update_session(id, title, memory_enabled, notes_enabled, expected_revision)
            .map_err(|error| error.to_string())
    }

    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let mut state = self.state()?;
        if state.active.is_some() || state.notes_active.is_some() {
            return Err("Stop the current operation before deleting a conversation.".into());
        }
        state
            .vault
            .as_mut()
            .ok_or("Unlock your vault first.")?
            .delete_session(id)
            .map_err(|error| error.to_string())
    }

    pub fn list_messages(&self, session_id: &str) -> Result<Vec<Message>, String> {
        self.state()?
            .vault
            .as_ref()
            .ok_or("Unlock your vault first.")?
            .list_messages(session_id)
            .map_err(|error| error.to_string())
    }

    pub fn prepare_turn(&self, session_id: &str, content: &str) -> Result<PreparedTurn, String> {
        self.prepare_turn_with_provider(session_id, content, ProviderKind::Ollama, false)
    }

    pub fn prepare_turn_with_provider(
        &self,
        session_id: &str,
        content: &str,
        provider: ProviderKind,
        remote_consent: bool,
    ) -> Result<PreparedTurn, String> {
        let mut state = self.state()?;
        authorize_provider(&state, provider, remote_consent)?;
        if content.trim().is_empty() || content.len() > 6_000 {
            return Err("Write a message of up to 6,000 UTF-8 bytes before sending.".into());
        }
        if state.active.is_some() || state.notes_active.is_some() {
            return Err("Wait for the current reply to finish, or stop it first.".into());
        }
        let vault = state.vault.as_mut().ok_or("Unlock your vault first.")?;
        let session = vault
            .get_session(session_id)
            .map_err(|error| error.to_string())?;
        let mut history = vault
            .list_context_messages(session_id)
            .map_err(|error| error.to_string())?;
        // Check the session branch before touching the global memory bundle;
        // an off conversation must never retrieve saved context.
        let memory = if session.memory_enabled {
            vault
                .memory_context(1_000)
                .map_err(|error| error.to_string())?
        } else {
            String::new()
        };
        let (user, assistant) = vault
            .begin_turn(session_id, content)
            .map_err(|error| error.to_string())?;
        history.push(user.clone());
        // Always keep the current input intact. Saved context gets only spare room.
        let memory = if content.len() + memory.len() + 180 <= 6_000 {
            memory
        } else {
            String::new()
        };
        let history_budget = if memory.is_empty() {
            6_000
        } else {
            6_000 - memory.len() - 180
        };
        let cancel = CancellationToken::new();
        state.active = Some(ActiveTurn {
            message_id: assistant.id.clone(),
            cancel: cancel.clone(),
        });
        Ok(PreparedTurn {
            user,
            assistant,
            history: recent_context(history, history_budget),
            memory,
            cancel,
        })
    }

    pub fn append_chunk(&self, message_id: &str, content: &str) -> Result<(), String> {
        let mut state = self.state()?;
        let active = state.active.as_ref().ok_or("The reply was stopped.")?;
        if active.message_id != message_id || active.cancel.is_cancelled() {
            return Err("The reply was stopped.".into());
        }
        state
            .vault
            .as_mut()
            .ok_or("The vault is locked.")?
            .append_assistant_chunk(message_id, content)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn finish_turn(
        &self,
        message_id: &str,
        status: MessageStatus,
    ) -> Result<Option<MessageStatus>, String> {
        let mut state = self.state()?;
        finish_turn_locked(&mut state, message_id, status)
    }

    /// Finish a response and reserve its notes job while holding the same
    /// engine mutex. This closes the interval where another turn or a stop
    /// request could otherwise arrive before `notes_active` is registered.
    /// Errors claiming notes stay attached to the successful reply result.
    pub fn finish_turn_and_prepare_notes(
        &self,
        message_id: &str,
        status: MessageStatus,
    ) -> Result<Option<FinishedTurn>, String> {
        let mut state = self.state()?;
        let Some(status) = finish_turn_locked(&mut state, message_id, status)? else {
            return Ok(None);
        };
        let notes = if status == MessageStatus::Complete {
            prepare_notes_locked(&mut state, message_id)
        } else {
            Ok(None)
        };
        Ok(Some(FinishedTurn { status, notes }))
    }

    pub fn list_notes(&self) -> Result<Vec<UserNote>, String> {
        self.state()?
            .vault
            .as_ref()
            .ok_or("Unlock your vault first.")?
            .list_notes()
            .map_err(|error| error.to_string())
    }

    pub fn list_memories(&self) -> Result<Vec<MemoryRecord>, String> {
        self.state()?
            .vault
            .as_ref()
            .ok_or("Unlock your vault first.")?
            .list_memories()
            .map_err(|error| error.to_string())
    }

    pub fn notes_permissions(&self, message_id: &str) -> Result<(bool, bool), String> {
        self.state()?
            .vault
            .as_ref()
            .ok_or("Unlock your vault first.")?
            .notes_permissions(message_id)
            .map_err(|error| error.to_string())
    }

    pub fn edit_memory(
        &self,
        id: &str,
        content: &str,
        revision: i64,
    ) -> Result<MemoryRecord, String> {
        let mut state = self.state()?;
        if state.active.is_some() || state.notes_active.is_some() {
            return Err("Stop the current operation before correcting remembered context.".into());
        }
        state
            .vault
            .as_mut()
            .ok_or("Unlock your vault first.")?
            .edit_memory(id, content, revision)
            .map_err(|error| error.to_string())
    }

    pub fn delete_memory(&self, id: &str, revision: i64) -> Result<(), String> {
        let mut state = self.state()?;
        if state.active.is_some() || state.notes_active.is_some() {
            return Err("Stop the current operation before forgetting remembered context.".into());
        }
        state
            .vault
            .as_mut()
            .ok_or("Unlock your vault first.")?
            .delete_memory(id, revision)
            .map_err(|error| error.to_string())
    }

    pub fn edit_note(&self, id: &str, content: &str, revision: i64) -> Result<UserNote, String> {
        self.state()?
            .vault
            .as_mut()
            .ok_or("Unlock your vault first.")?
            .edit_note(id, content, revision)
            .map_err(|error| error.to_string())
    }

    pub fn delete_note(&self, id: &str, revision: i64) -> Result<(), String> {
        self.state()?
            .vault
            .as_mut()
            .ok_or("Unlock your vault first.")?
            .delete_note(id, revision)
            .map_err(|error| error.to_string())
    }

    pub fn prepare_notes(&self, message_id: &str) -> Result<Option<PreparedNotes>, String> {
        self.prepare_notes_with_provider(message_id, ProviderKind::Ollama, false)
    }

    pub fn prepare_notes_with_provider(
        &self,
        message_id: &str,
        provider: ProviderKind,
        remote_consent: bool,
    ) -> Result<Option<PreparedNotes>, String> {
        let mut state = self.state()?;
        let call_required = state
            .vault
            .as_ref()
            .ok_or("Unlock your vault first.")?
            .notes_call_required(message_id)
            .map_err(|error| error.to_string())?;
        // Both branches can be disabled for a source turn. In that case the
        // structured call is intentionally skipped, including remote-provider
        // authorization, because no source data will leave the vault.
        if call_required {
            authorize_provider(&state, provider, remote_consent)?;
        }
        prepare_notes_locked(&mut state, message_id)
    }

    pub fn finish_notes(
        &self,
        attempt_id: &str,
        patch: Option<&NotePatch>,
    ) -> Result<Option<NotesStatus>, String> {
        let mut state = self.state()?;
        let Some(active) = state.notes_active.as_ref() else {
            return Ok(None);
        };
        if active.attempt_id != attempt_id {
            return Ok(None);
        }
        let active = state.notes_active.take().expect("matching notes attempt");
        let vault = state.vault.as_mut().ok_or("The vault is locked.")?;
        if active.cancel.is_cancelled() || patch.is_none() {
            vault
                .fail_notes(&active.message_id)
                .map_err(|error| error.to_string())?;
            return Ok(Some(NotesStatus::Failed));
        }
        if let Err(error) = vault.apply_notes(&active.message_id, patch.expect("patch checked")) {
            let _ = vault.fail_notes(&active.message_id);
            return Err(error.to_string());
        }
        Ok(Some(NotesStatus::Complete))
    }

    pub fn cancel_turn(&self) -> Result<(), String> {
        let state = self.state()?;
        if let Some(active) = &state.active {
            active.cancel.cancel();
        }
        if let Some(active) = &state.notes_active {
            active.cancel.cancel();
        }
        Ok(())
    }
}

fn authorize_provider(
    state: &State,
    provider: ProviderKind,
    remote_consent: bool,
) -> Result<(), String> {
    if provider != ProviderKind::Codex {
        return Ok(());
    }
    if !state.is_demo {
        return Err(CODEX_DEMO_ONLY_ERROR.into());
    }
    if !remote_consent {
        return Err(CODEX_CONSENT_REQUIRED_ERROR.into());
    }
    Ok(())
}

fn finish_turn_locked(
    state: &mut State,
    message_id: &str,
    status: MessageStatus,
) -> Result<Option<MessageStatus>, String> {
    let Some(active) = state.active.as_ref() else {
        return Ok(None);
    };
    if active.message_id != message_id {
        return Ok(None);
    }
    let actual_status = if active.cancel.is_cancelled() {
        MessageStatus::Interrupted
    } else {
        status
    };
    let result = state
        .vault
        .as_mut()
        .ok_or("The vault is locked.")?
        .finish_assistant_message(message_id, actual_status)
        .map(|_| ())
        .map_err(|error| error.to_string());
    state.active.take();
    result.map(|_| Some(actual_status))
}

fn prepare_notes_locked(
    state: &mut State,
    message_id: &str,
) -> Result<Option<PreparedNotes>, String> {
    if state.active.is_some() || state.notes_active.is_some() {
        return Err("Wait for the current operation to finish.".into());
    }
    let vault = state.vault.as_mut().ok_or("Unlock your vault first.")?;
    let input = match vault.begin_notes(message_id) {
        Ok(input) => input,
        Err(crate::vault::VaultError::NotesAlreadyComplete) => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let attempt_id = uuid::Uuid::new_v4().to_string();
    let cancel = CancellationToken::new();
    let skipped = !input.memory_enabled && !input.notes_enabled;
    if skipped {
        vault
            .complete_notes_without_writes(message_id)
            .map_err(|error| error.to_string())?;
        return Ok(Some(PreparedNotes {
            attempt_id,
            input,
            cancel,
            skipped: true,
        }));
    }
    state.notes_active = Some(ActiveNotes {
        attempt_id: attempt_id.clone(),
        message_id: message_id.into(),
        cancel: cancel.clone(),
    });
    Ok(Some(PreparedNotes {
        attempt_id,
        input,
        cancel,
        skipped: false,
    }))
}

fn seed_demo(vault: &mut Vault) -> crate::vault::Result<()> {
    if !vault.list_sessions()?.is_empty() {
        return Ok(());
    }
    let samples = [
        ("Making room for a slower week", "I turn rest into another task. I want to leave Sunday mornings free from planning.", "It sounds like planning has been taking up the space you wanted for rest. What would a free Sunday morning look like to you?", "Leave Sunday mornings free from planning.", "I want to leave Sunday mornings free from planning."),
        ("A boundary worth keeping", "I keep checking work messages at dinner. I want to put my phone away when I sit down to eat.", "You have a specific boundary in mind. What usually draws you back to the phone during dinner?", "Put the phone away during dinner.", "I want to put my phone away when I sit down to eat."),
        ("Finding time for a friend", "I miss talking to my friend Sam. I would like to ask Sam to go for a walk this weekend.", "A walk sounds like a way to make time together. What would you like to catch up on?", "Ask Sam about a walk this weekend.", "I would like to ask Sam to go for a walk this weekend."),
    ];
    for (title, user, assistant, note, quote) in samples {
        let session = vault.create_session_with_title(title)?;
        let (_, reply) = vault.begin_turn(&session.id, user)?;
        vault.append_assistant_chunk(&reply.id, assistant)?;
        vault.finish_assistant_message(&reply.id, MessageStatus::Complete)?;
        vault.begin_notes(&reply.id)?;
        let patch: NotePatch = serde_json::from_value(serde_json::json!({
            "memories": [{"kind":"goal", "content":note, "evidenceQuote":quote}],
            "notes": [{"kind":"next_step", "content":note, "evidenceQuote":quote}]
        }))
        .map_err(|_| crate::vault::VaultError::InvalidInput("invalid demo fixture"))?;
        vault.apply_notes(&reply.id, &patch)?;
    }
    Ok(())
}

fn recent_context(messages: Vec<Message>, budget: usize) -> Vec<Message> {
    let mut bytes = 0;
    let mut recent = Vec::new();
    for message in messages.into_iter().rev() {
        if message.role == MessageRole::Assistant && message.status != MessageStatus::Complete {
            continue;
        }
        if recent.len() >= 20 || bytes + message.content.len() > budget {
            break;
        }
        bytes += message.content.len();
        recent.push(message);
    }
    recent.reverse();
    let first_user = recent
        .iter()
        .position(|message| message.role == MessageRole::User)
        .unwrap_or(recent.len());
    recent.drain(..first_user);
    recent
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSPHRASE: &str = "a synthetic vault passphrase";

    fn synthetic_patch() -> NotePatch {
        serde_json::from_value(serde_json::json!({
            "memories": [{
                "kind": "goal",
                "content": "Take a synthetic walk",
                "evidenceQuote": "I want to take a walk."
            }],
            "notes": [{
                "kind": "next_step",
                "content": "Plan a synthetic walk.",
                "evidenceQuote": "I want to take a walk."
            }]
        }))
        .expect("synthetic patch")
    }

    fn complete_turn(engine: &Engine, session_id: &str) -> FinishedTurn {
        let turn = engine
            .prepare_turn(session_id, "I want to take a walk.")
            .expect("prepare turn");
        engine
            .append_chunk(&turn.assistant.id, "A short synthetic reply.")
            .expect("append reply");
        engine
            .finish_turn_and_prepare_notes(&turn.assistant.id, MessageStatus::Complete)
            .expect("finish turn")
            .expect("finished turn")
    }

    #[test]
    fn demo_is_separate_and_never_unlocks_or_replaces_personal_vault() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        assert!(engine.open_demo(DEMO_ID, "wrong").is_err());
        assert!(!Vault::exists(temp.path().join("vault")));
        assert!(engine.open_demo(DEMO_ID, DEMO_PASSPHRASE).unwrap().is_demo);
        assert_eq!(engine.list_sessions().unwrap().len(), 3);
        assert_eq!(engine.list_notes().unwrap().len(), 3);
        assert!(!Vault::exists(temp.path().join("vault")));
        engine.lock().unwrap();
        engine.unlock(PASSPHRASE, true).unwrap();
        let personal = engine.create_session().unwrap();
        assert!(engine.open_demo(DEMO_ID, DEMO_PASSPHRASE).is_err());
        engine.lock().unwrap();
        assert!(engine.unlock(DEMO_PASSPHRASE, false).is_err());
        engine.open_demo(DEMO_ID, DEMO_PASSPHRASE).unwrap();
        assert_eq!(engine.list_sessions().unwrap().len(), 3);
        assert!(engine.list_messages(&personal.id).is_err());
        engine.lock().unwrap();
        engine.unlock(PASSPHRASE, false).unwrap();
        assert_eq!(engine.list_sessions().unwrap(), vec![personal]);
    }

    #[test]
    fn session_settings_are_persisted_and_revision_checked() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        assert_eq!(session.revision, 1);
        assert!(session.memory_enabled);
        assert!(session.notes_enabled);

        let updated = engine
            .update_session(
                &session.id,
                "🌿 A calmer synthetic week",
                false,
                true,
                session.revision,
            )
            .unwrap();
        assert_eq!(updated.title, "🌿 A calmer synthetic week");
        assert_eq!(updated.revision, 2);
        assert!(!updated.memory_enabled);
        assert!(updated.notes_enabled);
        assert!(engine
            .update_session(&session.id, "stale", true, false, session.revision)
            .unwrap_err()
            .contains("session revision conflict"));
        assert!(engine
            .update_session(
                &session.id,
                &"🙂".repeat(crate::vault::MAX_SESSION_TITLE_CHARS + 1),
                false,
                true,
                updated.revision,
            )
            .is_err());

        engine.lock().unwrap();
        engine.unlock(PASSPHRASE, false).unwrap();
        assert_eq!(engine.list_sessions().unwrap(), vec![updated]);
    }

    #[test]
    fn session_settings_change_is_rejected_during_reply_or_notes_work() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();

        let turn = engine
            .prepare_turn(&session.id, "A synthetic active reply.")
            .unwrap();
        assert!(engine
            .update_session(&session.id, "renamed", false, false, session.revision)
            .is_err());
        engine.cancel_turn().unwrap();
        engine
            .finish_turn(&turn.assistant.id, MessageStatus::Interrupted)
            .unwrap();

        let finished = complete_turn(&engine, &session.id);
        let notes = finished.notes.unwrap().unwrap();
        assert!(engine
            .update_session(&session.id, "renamed", false, false, session.revision)
            .is_err());
        engine.cancel_turn().unwrap();
        assert_eq!(
            engine.finish_notes(&notes.attempt_id, None).unwrap(),
            Some(NotesStatus::Failed)
        );
        let updated = engine
            .update_session(&session.id, "renamed", false, false, session.revision)
            .unwrap();
        assert_eq!(updated.title, "renamed");
        assert!(!updated.memory_enabled);
        assert!(!updated.notes_enabled);
    }

    #[test]
    fn memory_off_session_suppresses_retrieval_and_writes_but_keeps_notes() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();

        // Seed one active memory while both branches are enabled.
        let first = complete_turn(&engine, &session.id);
        let first_notes = first.notes.unwrap().unwrap();
        engine
            .finish_notes(&first_notes.attempt_id, Some(&synthetic_patch()))
            .unwrap();
        assert_eq!(engine.list_memories().unwrap().len(), 1);
        assert_eq!(engine.list_notes().unwrap().len(), 1);

        let settings = engine
            .update_session(&session.id, "Memory off", false, true, session.revision)
            .unwrap();
        let second = complete_turn(&engine, &session.id);
        assert!(second.status == MessageStatus::Complete);
        // The global saved bundle is skipped before retrieval for this
        // conversation, while its ordinary transcript remains available.
        let turn_history_memory = engine
            .prepare_turn(&session.id, "should be blocked while notes active")
            .err()
            .expect("notes work blocks another turn");
        assert!(turn_history_memory.contains("current reply"));
        let second_notes = second.notes.unwrap().unwrap();
        assert!(!second_notes.input.memory_enabled);
        assert!(second_notes.input.notes_enabled);
        engine
            .finish_notes(&second_notes.attempt_id, Some(&synthetic_patch()))
            .unwrap();
        // The old memory remains durable but the off-source turn cannot add a
        // new one; the notes branch still receives its output.
        assert_eq!(engine.list_memories().unwrap().len(), 1);
        assert_eq!(engine.list_notes().unwrap().len(), 2);
        assert_eq!(settings.revision, 2);

        let next = engine
            .prepare_turn(&session.id, "A transcript-only synthetic follow-up.")
            .unwrap();
        assert!(next.memory.is_empty());
        assert!(next.history.iter().any(|message| {
            message.role == MessageRole::User && message.content == "I want to take a walk."
        }));
        engine.cancel_turn().unwrap();
        engine
            .finish_turn(&next.assistant.id, MessageStatus::Interrupted)
            .unwrap();
    }

    #[test]
    fn notes_off_session_writes_memory_without_notebook_entries() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        let settings = engine
            .update_session(&session.id, "Notes off", true, false, session.revision)
            .unwrap();

        let finished = complete_turn(&engine, &session.id);
        let notes = finished.notes.unwrap().unwrap();
        assert!(notes.input.memory_enabled);
        assert!(!notes.input.notes_enabled);
        assert_eq!(
            engine
                .finish_notes(&notes.attempt_id, Some(&synthetic_patch()))
                .unwrap(),
            Some(NotesStatus::Complete)
        );
        assert_eq!(engine.list_memories().unwrap().len(), 1);
        assert!(engine.list_notes().unwrap().is_empty());
        let next = engine
            .prepare_turn(&session.id, "A synthetic memory follow-up.")
            .unwrap();
        assert!(next.memory.contains("Take a synthetic walk"));
        assert_eq!(settings.revision, 2);
        engine.cancel_turn().unwrap();
        engine
            .finish_turn(&next.assistant.id, MessageStatus::Interrupted)
            .unwrap();
    }

    #[test]
    fn neither_branch_skips_provider_and_marks_job_without_writes() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        engine
            .update_session(&session.id, "No derivation", false, false, session.revision)
            .unwrap();

        let finished = complete_turn(&engine, &session.id);
        let notes = finished.notes.unwrap().unwrap();
        assert!(notes.skipped);
        assert!(!notes.input.memory_enabled);
        assert!(!notes.input.notes_enabled);
        assert!(engine.list_memories().unwrap().is_empty());
        assert!(engine.list_notes().unwrap().is_empty());
        // No remote consent or demo authorization is needed when no source
        // branch can send data to a structured provider.
        assert!(engine
            .prepare_notes_with_provider(&notes.input.assistant_id, ProviderKind::Codex, false)
            .unwrap()
            .is_none());
    }

    #[test]
    fn turning_off_then_on_does_not_restore_failed_job_branch_after_restart() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        let turn = engine
            .prepare_turn(&session.id, "I want to take a walk.")
            .unwrap();
        engine
            .finish_turn(&turn.assistant.id, MessageStatus::Complete)
            .unwrap();

        let disabled = engine
            .update_session(&session.id, "Memory paused", false, true, session.revision)
            .unwrap();
        // Locking makes this pending job failed, then re-enable the session.
        // Its captured memory permission must remain revoked.
        engine.lock().unwrap();
        engine.unlock(PASSPHRASE, false).unwrap();
        let enabled = engine
            .update_session(&session.id, "Memory resumed", true, true, disabled.revision)
            .unwrap();
        let retry = engine.prepare_notes(&turn.assistant.id).unwrap().unwrap();
        assert!(!retry.input.memory_enabled);
        assert!(retry.input.notes_enabled);
        engine
            .finish_notes(&retry.attempt_id, Some(&synthetic_patch()))
            .unwrap();
        assert!(engine.list_memories().unwrap().is_empty());
        assert_eq!(engine.list_notes().unwrap().len(), 1);
        assert_eq!(enabled.revision, 3);
    }

    #[test]
    fn source_submitted_while_memory_off_stays_memory_free_after_retry() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        let disabled = engine
            .update_session(
                &session.id,
                "Memory disabled",
                false,
                true,
                session.revision,
            )
            .unwrap();
        let turn = engine
            .prepare_turn(&session.id, "I want to take a walk.")
            .unwrap();
        engine
            .finish_turn(&turn.assistant.id, MessageStatus::Complete)
            .unwrap();
        let first_attempt = engine.prepare_notes(&turn.assistant.id).unwrap().unwrap();
        assert!(!first_attempt.input.memory_enabled);
        assert!(first_attempt.input.notes_enabled);
        engine.cancel_turn().unwrap();
        assert_eq!(
            engine
                .finish_notes(&first_attempt.attempt_id, None)
                .unwrap(),
            Some(NotesStatus::Failed)
        );

        let enabled = engine
            .update_session(&session.id, "Memory enabled", true, true, disabled.revision)
            .unwrap();
        let retry = engine.prepare_notes(&turn.assistant.id).unwrap().unwrap();
        assert!(!retry.input.memory_enabled);
        assert!(retry.input.notes_enabled);
        engine
            .finish_notes(&retry.attempt_id, Some(&synthetic_patch()))
            .unwrap();
        assert!(engine.list_memories().unwrap().is_empty());
        assert_eq!(engine.list_notes().unwrap().len(), 1);
        assert_eq!(enabled.revision, 3);
    }

    #[test]
    fn source_submitted_while_notes_off_stays_notebook_free_after_retry() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        let disabled = engine
            .update_session(&session.id, "Notes disabled", true, false, session.revision)
            .unwrap();
        let turn = engine
            .prepare_turn(&session.id, "I want to take a walk.")
            .unwrap();
        engine
            .finish_turn(&turn.assistant.id, MessageStatus::Complete)
            .unwrap();
        let first_attempt = engine.prepare_notes(&turn.assistant.id).unwrap().unwrap();
        assert!(first_attempt.input.memory_enabled);
        assert!(!first_attempt.input.notes_enabled);
        engine.cancel_turn().unwrap();
        assert_eq!(
            engine
                .finish_notes(&first_attempt.attempt_id, None)
                .unwrap(),
            Some(NotesStatus::Failed)
        );

        let enabled = engine
            .update_session(&session.id, "Notes enabled", true, true, disabled.revision)
            .unwrap();
        let retry = engine.prepare_notes(&turn.assistant.id).unwrap().unwrap();
        assert!(retry.input.memory_enabled);
        assert!(!retry.input.notes_enabled);
        engine
            .finish_notes(&retry.attempt_id, Some(&synthetic_patch()))
            .unwrap();
        assert_eq!(engine.list_memories().unwrap().len(), 1);
        assert!(engine.list_notes().unwrap().is_empty());
        assert_eq!(enabled.revision, 3);
    }

    #[test]
    fn codex_requires_demo_and_consent_before_turn_or_notes_mutation() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();

        assert_eq!(ProviderKind::default(), ProviderKind::Ollama);
        assert_eq!(
            serde_json::to_string(&ProviderKind::Codex).unwrap(),
            "\"codex\""
        );
        assert_eq!(
            serde_json::from_str::<ProviderKind>("\"ollama\"").unwrap(),
            ProviderKind::Ollama
        );

        let error = engine
            .prepare_turn_with_provider(
                &session.id,
                "This unauthorized synthetic turn must not persist.",
                ProviderKind::Codex,
                true,
            )
            .err()
            .expect("personal Codex turn should be rejected");
        assert_eq!(error, CODEX_DEMO_ONLY_ERROR);
        assert!(engine.list_messages(&session.id).unwrap().is_empty());
        assert_eq!(engine.require_demo().unwrap_err(), DEMO_REQUIRED_ERROR);

        let turn = engine
            .prepare_turn(&session.id, "A synthetic Ollama turn.")
            .unwrap();
        engine
            .finish_turn(&turn.assistant.id, MessageStatus::Complete)
            .unwrap();
        let error = engine
            .prepare_notes_with_provider(&turn.assistant.id, ProviderKind::Codex, true)
            .err()
            .expect("personal Codex notes should be rejected");
        assert_eq!(error, CODEX_DEMO_ONLY_ERROR);
        let ollama_notes = engine
            .prepare_notes(&turn.assistant.id)
            .unwrap()
            .expect("Ollama notes should still claim the pending job");
        engine.finish_notes(&ollama_notes.attempt_id, None).unwrap();

        engine.lock().unwrap();
        engine.open_demo(DEMO_ID, DEMO_PASSPHRASE).unwrap();
        assert!(engine.require_demo().is_ok());
        let demo_session = engine.list_sessions().unwrap().remove(0);
        let before = engine.list_messages(&demo_session.id).unwrap().len();
        let error = engine
            .prepare_turn_with_provider(
                &demo_session.id,
                "This synthetic remote turn lacks consent.",
                ProviderKind::Codex,
                false,
            )
            .err()
            .expect("Codex without consent should be rejected");
        assert_eq!(error, CODEX_CONSENT_REQUIRED_ERROR);
        assert_eq!(
            engine.list_messages(&demo_session.id).unwrap().len(),
            before
        );

        let allowed = engine
            .prepare_turn_with_provider(
                &demo_session.id,
                "An allowed synthetic Codex turn.",
                ProviderKind::Codex,
                true,
            )
            .unwrap();
        engine
            .finish_turn(&allowed.assistant.id, MessageStatus::Complete)
            .unwrap();
        let notes = engine
            .prepare_notes_with_provider(&allowed.assistant.id, ProviderKind::Codex, true)
            .unwrap()
            .expect("allowed Codex notes should claim the job");
        engine.finish_notes(&notes.attempt_id, None).unwrap();
    }

    #[test]
    fn locking_notes_prevents_an_old_attempt_committing_into_a_retry() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        let turn = engine
            .prepare_turn(&session.id, "I want to take a walk.")
            .unwrap();
        engine
            .append_chunk(&turn.assistant.id, "When would you like to go?")
            .unwrap();
        engine
            .finish_turn(&turn.assistant.id, MessageStatus::Complete)
            .unwrap();
        let old = engine.prepare_notes(&turn.assistant.id).unwrap().unwrap();
        assert!(engine.prepare_turn(&session.id, "Another message").is_err());
        engine.lock().unwrap();
        assert!(old.cancel.is_cancelled());
        engine.unlock(PASSPHRASE, false).unwrap();
        let new = engine.prepare_notes(&turn.assistant.id).unwrap().unwrap();
        let patch: NotePatch = serde_json::from_value(serde_json::json!({"memories":[],"notes":[{"kind":"next_step","content":"Take a walk.","evidenceQuote":"I want to take a walk."}]})).unwrap();
        assert!(engine
            .finish_notes(&old.attempt_id, Some(&patch))
            .unwrap()
            .is_none());
        assert!(engine.list_notes().unwrap().is_empty());
        assert!(matches!(
            engine.finish_notes(&new.attempt_id, Some(&patch)).unwrap(),
            Some(NotesStatus::Complete)
        ));
        let note = engine.list_notes().unwrap().remove(0);
        engine
            .edit_note(&note.id, "Take a short walk tomorrow.", note.revision)
            .unwrap();
        assert!(engine.delete_note(&note.id, note.revision).is_err());
        assert!(engine.prepare_notes(&turn.assistant.id).unwrap().is_none());
    }

    #[test]
    fn completed_turn_reserves_notes_before_next_turn_or_cancel() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        let turn = engine
            .prepare_turn(&session.id, "I want to take a walk.")
            .unwrap();
        engine
            .append_chunk(&turn.assistant.id, "When would you like to go?")
            .unwrap();

        let finished = engine
            .finish_turn_and_prepare_notes(&turn.assistant.id, MessageStatus::Complete)
            .unwrap()
            .unwrap();
        assert_eq!(finished.status, MessageStatus::Complete);
        let notes = finished
            .notes
            .expect("notes reservation should succeed")
            .expect("completed turn should reserve notes");

        assert!(engine
            .prepare_turn(&session.id, "A second message")
            .is_err());
        engine.cancel_turn().unwrap();
        assert!(notes.cancel.is_cancelled());
        assert!(matches!(
            engine.finish_notes(&notes.attempt_id, None).unwrap(),
            Some(NotesStatus::Failed)
        ));

        let messages = engine.list_messages(&session.id).unwrap();
        assert_eq!(messages[1].status, MessageStatus::Complete);
        let next = engine
            .prepare_turn(&session.id, "A second message")
            .unwrap();
        engine.cancel_turn().unwrap();
        engine
            .finish_turn(&next.assistant.id, MessageStatus::Interrupted)
            .unwrap();
    }

    #[test]
    fn locking_cancels_generation_and_rejects_late_writes() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        let turn = engine
            .prepare_turn(&session.id, "A synthetic message")
            .unwrap();
        engine
            .append_chunk(&turn.assistant.id, "A partial reply.")
            .unwrap();
        engine.lock().unwrap();
        assert!(turn.cancel.is_cancelled());
        assert!(engine
            .append_chunk(&turn.assistant.id, "Must not persist")
            .is_err());
        assert!(engine.list_messages(&session.id).is_err());
        engine.unlock(PASSPHRASE, false).unwrap();
        let messages = engine.list_messages(&session.id).unwrap();
        assert_eq!(messages[1].content, "A partial reply.");
        assert_eq!(messages[1].status, MessageStatus::Interrupted);
        let next = engine
            .prepare_turn(&session.id, "The next message")
            .unwrap();
        assert!(engine
            .finish_turn(&turn.assistant.id, MessageStatus::Complete)
            .unwrap()
            .is_none());
        assert!(engine
            .append_chunk(&next.assistant.id, "Next reply")
            .is_ok());
    }

    #[test]
    fn memory_writes_wait_for_idle_work_and_persist_across_lock() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();

        let first = engine
            .prepare_turn(&session.id, "I want to take a walk.")
            .unwrap();
        engine
            .append_chunk(&first.assistant.id, "That sounds restorative.")
            .unwrap();
        let finished = engine
            .finish_turn_and_prepare_notes(&first.assistant.id, MessageStatus::Complete)
            .unwrap()
            .unwrap();
        let notes = finished.notes.unwrap().unwrap();
        let patch: NotePatch = serde_json::from_value(serde_json::json!({
            "memories": [{
                "kind": "goal",
                "content": "Take a walk",
                "evidenceQuote": "I want to take a walk."
            }],
            "notes": []
        }))
        .unwrap();
        assert!(matches!(
            engine
                .finish_notes(&notes.attempt_id, Some(&patch))
                .unwrap(),
            Some(NotesStatus::Complete)
        ));
        let memory = engine.list_memories().unwrap().pop().unwrap();

        let second = engine
            .prepare_turn(&session.id, "A second synthetic turn.")
            .unwrap();
        assert!(engine
            .edit_memory(&memory.id, "A corrected walk goal", memory.revision)
            .is_err());
        assert!(engine.delete_memory(&memory.id, memory.revision).is_err());
        engine.cancel_turn().unwrap();
        engine
            .finish_turn(&second.assistant.id, MessageStatus::Interrupted)
            .unwrap();

        let third = engine
            .prepare_turn(&session.id, "A third synthetic turn.")
            .unwrap();
        engine
            .append_chunk(&third.assistant.id, "A short reply.")
            .unwrap();
        let finished = engine
            .finish_turn_and_prepare_notes(&third.assistant.id, MessageStatus::Complete)
            .unwrap()
            .unwrap();
        let notes = finished.notes.unwrap().unwrap();
        assert!(engine
            .edit_memory(&memory.id, "Another corrected goal", memory.revision)
            .is_err());
        assert!(engine.delete_memory(&memory.id, memory.revision).is_err());

        engine.lock().unwrap();
        assert!(notes.cancel.is_cancelled());
        assert!(engine.list_memories().is_err());
        engine.unlock(PASSPHRASE, false).unwrap();
        let persisted = engine.list_memories().unwrap().pop().unwrap();
        assert_eq!(persisted.content, memory.content);
        assert_eq!(persisted.revision, memory.revision);

        engine
            .delete_memory(&persisted.id, persisted.revision)
            .unwrap();
        let after_forget = engine
            .prepare_turn(&session.id, "A fresh synthetic turn.")
            .unwrap();
        assert!(after_forget.history.iter().all(|message| {
            message.id != persisted.source_message_id
                && message.id != persisted.assistant_message_id
        }));
        assert!(after_forget.memory.is_empty());
        engine.cancel_turn().unwrap();
        engine
            .finish_turn(&after_forget.assistant.id, MessageStatus::Interrupted)
            .unwrap();
    }

    #[test]
    fn renderer_reconnect_stops_unattached_turn_and_allows_next_send() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        let turn = engine.prepare_turn(&session.id, "Synthetic input").unwrap();
        assert!(engine.reconnect_renderer().unwrap().unlocked);
        assert!(turn.cancel.is_cancelled());
        assert_eq!(
            engine.list_messages(&session.id).unwrap()[1].status,
            MessageStatus::Interrupted
        );
        assert!(engine.prepare_turn(&session.id, "After reload").is_ok());
    }

    #[test]
    fn context_keeps_current_input_and_respects_byte_budget() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        assert!(engine
            .prepare_turn(&session.id, &"x".repeat(6_001))
            .is_err());
        assert!(engine.list_messages(&session.id).unwrap().is_empty());
        let turn = engine
            .prepare_turn(&session.id, &"x".repeat(6_000))
            .unwrap();
        assert_eq!(turn.history.last().unwrap().content.len(), 6_000);
        engine.cancel_turn().unwrap();
        assert_eq!(
            engine
                .finish_turn(&turn.assistant.id, MessageStatus::Complete)
                .unwrap(),
            Some(MessageStatus::Interrupted)
        );
    }

    #[test]
    fn only_one_turn_can_write_and_cancelled_output_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let engine = Engine::new(temp.path().join("vault"));
        engine.unlock(PASSPHRASE, true).unwrap();
        let session = engine.create_session().unwrap();
        let turn = engine.prepare_turn(&session.id, "Synthetic input").unwrap();
        assert!(engine.prepare_turn(&session.id, "Another input").is_err());
        engine.cancel_turn().unwrap();
        assert!(engine
            .append_chunk(&turn.assistant.id, "Late output")
            .is_err());
        engine
            .finish_turn(&turn.assistant.id, MessageStatus::Complete)
            .unwrap();
        let messages = engine.list_messages(&session.id).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].status, MessageStatus::Interrupted);
    }
}
