use std::{path::PathBuf, sync::Mutex};

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::{
    models::{Message, MessageRole, MessageStatus, Session},
    vault::Vault,
};

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
}

#[derive(Serialize)]
pub struct VaultStatus {
    pub exists: bool,
    pub unlocked: bool,
}

struct ActiveTurn {
    message_id: String,
    cancel: CancellationToken,
}

#[derive(Default)]
struct State {
    vault: Option<Vault>,
    active: Option<ActiveTurn>,
}

pub struct Engine {
    directory: PathBuf,
    state: Mutex<State>,
}

pub struct PreparedTurn {
    pub user: Message,
    pub assistant: Message,
    pub history: Vec<Message>,
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
        Ok(VaultStatus {
            exists: Vault::exists(&self.directory),
            unlocked: self.state()?.vault.is_some(),
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
        Ok(VaultStatus {
            exists: Vault::exists(&self.directory),
            unlocked: state.vault.is_some(),
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

    pub fn list_messages(&self, session_id: &str) -> Result<Vec<Message>, String> {
        self.state()?
            .vault
            .as_ref()
            .ok_or("Unlock your vault first.")?
            .list_messages(session_id)
            .map_err(|error| error.to_string())
    }

    pub fn prepare_turn(&self, session_id: &str, content: &str) -> Result<PreparedTurn, String> {
        if content.trim().is_empty() || content.len() > 6_000 {
            return Err("Write a message of up to 6,000 UTF-8 bytes before sending.".into());
        }
        let mut state = self.state()?;
        if state.active.is_some() {
            return Err("Wait for the current reply to finish, or stop it first.".into());
        }
        let vault = state.vault.as_mut().ok_or("Unlock your vault first.")?;
        let mut history = vault
            .list_messages(session_id)
            .map_err(|error| error.to_string())?;
        let (user, assistant) = vault
            .begin_turn(session_id, content)
            .map_err(|error| error.to_string())?;
        history.push(user.clone());
        let cancel = CancellationToken::new();
        state.active = Some(ActiveTurn {
            message_id: assistant.id.clone(),
            cancel: cancel.clone(),
        });
        Ok(PreparedTurn {
            user,
            assistant,
            history: recent_context(history),
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

    pub fn cancel_turn(&self) -> Result<(), String> {
        if let Some(active) = &self.state()?.active {
            active.cancel.cancel();
        }
        Ok(())
    }
}

fn recent_context(messages: Vec<Message>) -> Vec<Message> {
    let mut bytes = 0;
    let mut recent = Vec::new();
    for message in messages.into_iter().rev() {
        if message.role == MessageRole::Assistant && message.status != MessageStatus::Complete {
            continue;
        }
        if recent.len() >= 20 || bytes + message.content.len() > 6_000 {
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
