use std::{env, fs, path::PathBuf, time::Instant};

use openmind_lib::{
    codex,
    provider::{ChatMessage, ProviderError},
};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Deserialize)]
struct Fixture {
    scenarios: Vec<Scenario>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scenario {
    id: String,
    focus: String,
    #[serde(default)]
    history: Vec<ChatMessage>,
    #[serde(default)]
    forbidden_phrases: Vec<String>,
    turns: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationRun {
    model: String,
    generated_at: String,
    system_prompt: &'static str,
    scenarios: Vec<ScenarioResult>,
}

#[derive(Clone, Debug, Serialize)]
struct ScenarioResult {
    id: String,
    focus: String,
    exchanges: Vec<Exchange>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Exchange {
    user: String,
    assistant: String,
    elapsed_ms: u128,
}

fn fixture() -> Fixture {
    serde_json::from_str(include_str!("fixtures/conversation_quality.json"))
        .expect("valid conversation quality fixture")
}

fn normalized_text(input: &str) -> String {
    input.to_lowercase().replace(['’', '‘'], "'")
}

#[test]
fn synthetic_fixture_covers_distinct_high_risk_conversation_shapes() {
    let fixture = fixture();
    let ids = fixture
        .scenarios
        .iter()
        .map(|scenario| scenario.id.as_str())
        .collect::<std::collections::HashSet<_>>();

    assert_eq!(fixture.scenarios.len(), 10);
    assert_eq!(ids.len(), fixture.scenarios.len());
    assert!(ids.contains("immediate_self_harm_risk"));
    assert!(ids.contains("uncertain_childhood_memory"));
    assert!(ids.contains("current_disclosure_over_stale_memory"));
    assert!(fixture.scenarios.iter().all(|scenario| {
        !scenario.focus.trim().is_empty()
            && !scenario.turns.is_empty()
            && scenario.turns.iter().all(|turn| !turn.trim().is_empty())
    }));
    assert_eq!(normalized_text("I won’t"), normalized_text("I won't"));
}

async fn reply(model: &str, history: Vec<ChatMessage>) -> Result<String, ProviderError> {
    let mut output = String::new();
    codex::generate(model, history, CancellationToken::new(), |chunk| {
        output.push_str(&chunk?);
        Ok(())
    })
    .await?;
    Ok(output)
}

#[tokio::test]
#[ignore = "requires an explicitly selected model and ChatGPT subscription sign-in"]
async fn live_synthetic_conversation_quality_sample() {
    let model =
        env::var("OPENMIND_TEST_CODEX_MODEL").expect("select a subscription model explicitly");
    let output_path = env::var_os("OPENMIND_CONVERSATION_EVAL_OUTPUT")
        .map(PathBuf::from)
        .expect("select an explicit output path outside the tracked fixtures");
    let selected_scenario = env::var("OPENMIND_CONVERSATION_EVAL_SCENARIO").ok();
    let generated_at = chrono::Utc::now().to_rfc3339();
    let mut scenario_results = Vec::new();

    for scenario in fixture().scenarios.into_iter().filter(|scenario| {
        selected_scenario
            .as_ref()
            .is_none_or(|selected| selected == &scenario.id)
    }) {
        let mut history = scenario.history;
        let mut exchanges = Vec::new();
        for user in scenario.turns {
            history.push(ChatMessage {
                role: "user".into(),
                content: user.clone(),
            });
            let started = Instant::now();
            let assistant = reply(&model, history.clone())
                .await
                .unwrap_or_else(|error| panic!("scenario {} failed: {error}", scenario.id));
            assert!(
                !assistant.trim().is_empty(),
                "scenario {} returned an empty reply",
                scenario.id
            );
            let normalized = normalized_text(&assistant);
            for forbidden in &scenario.forbidden_phrases {
                assert!(
                    !normalized.contains(&normalized_text(forbidden)),
                    "scenario {} used forbidden phrase {forbidden:?}",
                    scenario.id
                );
            }
            let elapsed_ms = started.elapsed().as_millis();
            history.push(ChatMessage {
                role: "assistant".into(),
                content: assistant.clone(),
            });
            exchanges.push(Exchange {
                user,
                assistant,
                elapsed_ms,
            });
        }
        scenario_results.push(ScenarioResult {
            id: scenario.id,
            focus: scenario.focus,
            exchanges,
        });
        let checkpoint = EvaluationRun {
            model: model.clone(),
            generated_at: generated_at.clone(),
            system_prompt: openmind_lib::provider::SYSTEM_PROMPT,
            scenarios: scenario_results.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&checkpoint).expect("serialize evaluation output");
        fs::write(&output_path, bytes).expect("checkpoint evaluation output");
    }

    assert!(
        !scenario_results.is_empty(),
        "selected scenario was not found"
    );
    eprintln!("conversation_quality_output={}", output_path.display());
}
