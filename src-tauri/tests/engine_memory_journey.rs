use openmind_lib::engine::{Engine, NotesStatus};
use openmind_lib::models::MessageStatus;
use openmind_lib::notes::{MemoryCandidate, MemoryKind, NoteCandidate, NoteKind, NotePatch};
use openmind_lib::retrieval::RetrievalOptions;

const VAULT_PASSPHRASE: &str = "synthetic journey vault passphrase";
const BACKUP_PASSPHRASE: &str = "synthetic journey backup passphrase";

fn complete_memory_turn(
    engine: &Engine,
    session_id: &str,
    source: &str,
    reply: &str,
    patch: &NotePatch,
) {
    let turn = engine
        .prepare_turn(session_id, source)
        .expect("prepare durable turn");
    engine
        .append_chunk(&turn.assistant.id, reply)
        .expect("append synthetic reply");
    let finished = engine
        .finish_turn_and_prepare_notes(&turn.assistant.id, MessageStatus::Complete)
        .expect("finish durable turn")
        .expect("completed durable turn");
    let prepared = finished
        .notes
        .expect("claim notes result")
        .expect("notes work required");
    assert!(!prepared.skipped);
    assert_eq!(
        engine
            .finish_notes(&prepared.attempt_id, Some(patch))
            .expect("finish notes"),
        Some(NotesStatus::Complete)
    );
}

#[test]
fn encrypted_backup_restore_preserves_kept_memory_and_forgotten_exclusion() {
    let directory = tempfile::tempdir().expect("temporary journey root");
    let original_path = directory.path().join("original-vault");
    let restored_path = directory.path().join("restored-vault");
    let backup_path = directory.path().join("synthetic.openmind-backup");

    let engine = Engine::new(original_path);
    engine
        .unlock(VAULT_PASSPHRASE, true)
        .expect("create original vault");
    let durable = engine.create_session().expect("durable session");

    let kept_source = "I keep a small brass compass from my aunt on the bookshelf.";
    complete_memory_turn(
        &engine,
        &durable.id,
        kept_source,
        "That sounds like a meaningful keepsake.",
        &NotePatch {
            memories: vec![MemoryCandidate {
                kind: MemoryKind::Preference,
                content: "Keeps a brass compass from their aunt on the bookshelf".into(),
                evidence_quote: "brass compass from my aunt".into(),
            }],
            notes: vec![NoteCandidate {
                kind: NoteKind::Takeaway,
                content: "The brass compass is a meaningful keepsake.".into(),
                evidence_quote: "brass compass from my aunt".into(),
            }],
        },
    );

    let forgotten_source = "Mira is my sister and uses the synthetic phrase violet harbor.";
    complete_memory_turn(
        &engine,
        &durable.id,
        forgotten_source,
        "Thanks for clarifying who Mira is.",
        &NotePatch {
            memories: vec![MemoryCandidate {
                kind: MemoryKind::Person,
                content: "Mira is the user's sister and uses the phrase violet harbor".into(),
                evidence_quote: "Mira is my sister".into(),
            }],
            notes: vec![NoteCandidate {
                kind: NoteKind::Takeaway,
                content: "Mira was described as the user's sister.".into(),
                evidence_quote: "Mira is my sister".into(),
            }],
        },
    );

    let private = engine.create_private_session().expect("private session");
    let private_turn = engine
        .prepare_turn(
            &private.id,
            "This synthetic private sentence must not persist.",
        )
        .expect("prepare private turn");
    engine
        .append_chunk(&private_turn.assistant.id, "A transient reply.")
        .expect("append private reply");
    engine
        .finish_turn(&private_turn.assistant.id, MessageStatus::Complete)
        .expect("finish private turn");

    let memories = engine.list_memories().expect("list initial memories");
    let kept = memories
        .iter()
        .find(|memory| memory.content.contains("brass compass"))
        .expect("kept memory");
    let original = memories
        .iter()
        .find(|memory| memory.content.contains("violet harbor"))
        .expect("memory to correct");
    let corrected = engine
        .edit_memory(
            &original.id,
            "Mira is a coworker, not the user's sister",
            original.revision,
        )
        .expect("correct remembered identity");
    assert_eq!(corrected.revision, original.revision + 1);
    engine
        .delete_memory(&corrected.id, corrected.revision)
        .expect("forget corrected source");

    let before_backup = engine
        .retrieve_memory_context(
            "Mira violet harbor coworker sister",
            &RetrievalOptions::lexical(2_000, 4),
        )
        .expect("retrieve after forgetting");
    assert!(before_backup.matches.is_empty());
    assert_eq!(
        engine.list_memories().expect("post-forget memories").len(),
        1
    );
    assert_eq!(engine.list_notes().expect("post-forget notes").len(), 1);
    assert_eq!(
        engine
            .retrieve_memory_context(
                "brass compass aunt bookshelf",
                &RetrievalOptions::lexical(2_000, 4),
            )
            .expect("retrieve retained memory")
            .matches[0]
            .memory_id,
        kept.id
    );

    engine
        .export_backup(&backup_path, BACKUP_PASSPHRASE)
        .expect("export encrypted backup");
    let backup_bytes = std::fs::read(&backup_path).expect("read encrypted backup");
    assert!(!backup_bytes
        .windows(forgotten_source.len())
        .any(|window| window == forgotten_source.as_bytes()));
    engine.lock().expect("lock original vault");

    let restored = Engine::new(restored_path.clone());
    restored
        .restore_backup(&backup_path, BACKUP_PASSPHRASE, "REPLACE MY OPENMIND VAULT")
        .expect("restore encrypted backup");
    let sessions = restored.list_sessions().expect("restored sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, durable.id);
    assert!(!sessions.iter().any(|session| session.id == private.id));
    assert!(restored.list_messages(&private.id).is_err());
    assert_eq!(
        restored.list_memories().expect("restored memories").len(),
        1
    );
    assert_eq!(restored.list_notes().expect("restored notes").len(), 1);
    assert!(restored
        .retrieve_memory_context(
            "Mira violet harbor coworker sister",
            &RetrievalOptions::lexical(2_000, 4),
        )
        .expect("restored forgotten query")
        .matches
        .is_empty());
    assert!(restored
        .retrieve_memory_context(
            "brass compass aunt bookshelf",
            &RetrievalOptions::lexical(2_000, 4),
        )
        .expect("restored kept query")
        .context
        .contains("brass compass"));

    restored.lock().expect("lock restored vault");
    let reopened = Engine::new(restored_path);
    reopened
        .unlock(BACKUP_PASSPHRASE, false)
        .expect("reopen restored vault");
    assert_eq!(
        reopened.list_sessions().expect("reopened sessions").len(),
        1
    );
    assert_eq!(
        reopened.list_memories().expect("reopened memories").len(),
        1
    );
    assert!(reopened
        .retrieve_memory_context(
            "Mira violet harbor coworker sister",
            &RetrievalOptions::lexical(2_000, 4),
        )
        .expect("reopened forgotten query")
        .matches
        .is_empty());
}
