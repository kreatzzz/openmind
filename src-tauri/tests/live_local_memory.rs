//! Opt-in system test for a locally installed Ollama model.
//!
//! Run with `OPENMIND_TEST_MODEL=<installed model> OLLAMA_URL=http://127.0.0.1:11434
//! cargo test --test live_local_memory -- --ignored --nocapture`.

use std::sync::Arc;

use openmind_lib::{
    engine::{Engine, ProviderKind},
    models::{MessageRole, MessageStatus},
    provider::{self, ChatMessage, ProviderError},
    retrieval::RetrievalOptions,
};

const PASSPHRASE: &str = "synthetic live local memory passphrase";
const SOURCE: &str = "I am training for a synthetic lighthouse marathon in October, and I plan to run three times each week.";

#[tokio::test]
#[ignore = "requires an explicitly selected, already-installed local Ollama model"]
async fn local_model_turn_notes_reopen_and_retrieval() {
    let model = std::env::var("OPENMIND_TEST_MODEL")
        .expect("set OPENMIND_TEST_MODEL to an already-installed local Ollama model");
    let base_url = std::env::var("OLLAMA_URL").unwrap_or_else(|_| "http://127.0.0.1:11434".into());
    let temp = tempfile::tempdir().unwrap();
    let vault_path = temp.path().join("vault");
    let engine = Arc::new(Engine::new(vault_path.clone()));
    engine.unlock(PASSPHRASE, true).unwrap();
    let settings = engine.provider_settings().unwrap();
    engine
        .update_provider_settings(
            ProviderKind::Ollama,
            &base_url,
            &model,
            false,
            settings.revision,
            None,
            false,
        )
        .unwrap();

    let session = engine.create_session().unwrap();
    let prepared = engine.prepare_turn(&session.id, SOURCE).unwrap();
    let history = prepared
        .history
        .iter()
        .map(|message| ChatMessage {
            role: match message.role {
                MessageRole::User => "user",
                MessageRole::Assistant => "assistant",
            }
            .into(),
            content: message.content.clone(),
        })
        .collect();
    let message_id = prepared.assistant.id.clone();
    let callback_engine = Arc::clone(&engine);
    let callback_message_id = message_id.clone();
    provider::generate(
        &base_url,
        &model,
        history,
        prepared.cancel,
        move |chunk| match chunk {
            Ok(content) => callback_engine
                .append_chunk(&callback_message_id, &content)
                .map_err(|_| ProviderError::CallbackFailed),
            Err(error) => Err(error),
        },
    )
    .await
    .unwrap();
    engine
        .finish_turn(&message_id, MessageStatus::Complete)
        .unwrap();
    let saved = engine.list_messages(&session.id).unwrap();
    assert!(!saved[1].content.trim().is_empty());

    let notes = engine
        .prepare_notes(&message_id)
        .unwrap()
        .expect("completed turn should reserve notes");
    let patch = provider::extract_notes(
        &base_url,
        &model,
        &notes.input.user.content,
        notes.cancel.clone(),
    )
    .await
    .unwrap();
    assert!(
        !patch.memories.is_empty(),
        "the selected model did not extract a memory from the explicit synthetic fact"
    );
    assert!(patch
        .memories
        .iter()
        .all(|memory| SOURCE.contains(&memory.evidence_quote)));
    engine
        .finish_notes(&notes.attempt_id, Some(&patch))
        .unwrap();
    engine.lock().unwrap();
    drop(engine);

    let reopened = Engine::new(vault_path);
    reopened.unlock(PASSPHRASE, false).unwrap();
    let memories = reopened.list_memories().unwrap();
    assert!(!memories.is_empty());
    let retrieved = reopened
        .retrieve_memory_context(
            "What is the synthetic lighthouse marathon plan?",
            &RetrievalOptions::lexical(2_048, 8),
        )
        .unwrap();
    assert!(!retrieved.matches.is_empty());
    assert!(retrieved.context.to_lowercase().contains("lighthouse"));
}
