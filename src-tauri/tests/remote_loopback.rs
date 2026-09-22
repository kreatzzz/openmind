use std::sync::{Arc, Mutex};

use openmind_lib::provider::ChatMessage;
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

const LOOPBACK_OPENAI_URL: &str = "http://127.0.0.1:11434/v1";
const LOCAL_MODEL: &str = "qwen3.5:4b";
const DUMMY_API_KEY: &str = "openmind-loopback-test-only";

#[tokio::test]
#[ignore = "requires qwen3.5:4b in local Ollama with OpenAI compatibility enabled"]
async fn openai_compatible_loopback_generates_and_extracts_source_backed_notes() {
    let output = Arc::new(Mutex::new(String::new()));
    let callback_output = Arc::clone(&output);
    openmind_lib::remote::generate(
        LOOPBACK_OPENAI_URL,
        LOCAL_MODEL,
        Zeroizing::new(DUMMY_API_KEY.to_owned()),
        vec![ChatMessage {
            role: "user".into(),
            content: "Reply with the exact marker LOOPBACK_OK and no other words.".into(),
        }],
        CancellationToken::new(),
        move |chunk| {
            callback_output
                .lock()
                .expect("output mutex")
                .push_str(&chunk?);
            Ok(())
        },
    )
    .await
    .expect("stream through local OpenAI-compatible endpoint");
    let generated = output.lock().expect("output mutex").clone();
    assert_eq!(generated.trim(), "LOOPBACK_OK");

    let source = "I prefer a short written recap after difficult meetings.";
    let patch = openmind_lib::remote::extract_notes(
        LOOPBACK_OPENAI_URL,
        LOCAL_MODEL,
        Zeroizing::new(DUMMY_API_KEY.to_owned()),
        source,
        CancellationToken::new(),
    )
    .await
    .expect("extract through local OpenAI-compatible endpoint");
    patch
        .validate_against_source(source)
        .expect("adapter output remains mechanically source-backed");
    assert!(
        !patch.memories.is_empty() || !patch.notes.is_empty(),
        "unambiguous preference should produce at least one source-backed candidate"
    );
    eprintln!(
        "remote_loopback generated={generated:?} patch={}",
        serde_json::to_string(&patch).expect("serialize patch")
    );
}
