//! Query-aware retrieval over encrypted, source-backed memory records.
//!
//! FTS rows and embeddings remain in the SQLCipher vault. Ollama embedding
//! calls are optional, explicit, and restricted to a loopback HTTP endpoint.

use std::collections::HashMap;
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio_util::sync::CancellationToken;
use url::Host;

pub const MAX_RETRIEVAL_CANDIDATES: usize = 40;
pub const MAX_EMBEDDING_DIMENSIONS: usize = 8_192;
pub const MIN_SEMANTIC_SIMILARITY: f32 = 0.35;
const MAX_EMBED_INPUT_BYTES: usize = 6_000;
const MAX_EMBED_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const RRF_K: f32 = 60.0;

#[derive(Clone, Debug, PartialEq)]
pub struct QueryEmbedding {
    pub model: String,
    pub vector: Vec<f32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RetrievalOptions {
    pub max_bytes: usize,
    pub max_records: usize,
    pub query_embedding: Option<QueryEmbedding>,
}

impl RetrievalOptions {
    pub fn lexical(max_bytes: usize, max_records: usize) -> Self {
        Self {
            max_bytes,
            max_records,
            query_embedding: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievedMemory {
    pub memory_id: String,
    pub source_message_id: String,
    pub revision: i64,
    pub lexical_rank: Option<usize>,
    pub semantic_rank: Option<usize>,
    pub fused_score: f32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalResult {
    pub context: String,
    pub matches: Vec<RetrievedMemory>,
    pub omitted_count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryIndexState {
    Ready,
    Degraded,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryIndexStatus {
    pub state: MemoryIndexState,
    pub lexical_indexed: usize,
    pub eligible_records: usize,
    pub semantic_indexed: usize,
    pub stale_embeddings: usize,
    pub embedding_models: Vec<String>,
    pub last_rebuilt_at: Option<String>,
    pub active_embedding: Option<EmbeddingConfiguration>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingConfiguration {
    pub base_url: String,
    pub model: String,
    pub activated_at: String,
}

/// Prompt packing remains byte-enforced because Openmind does not currently
/// ship each model's tokenizer. The token target is planning metadata, not a
/// claim that UTF-8 bytes map to tokens at a fixed ratio.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContextBudget {
    pub max_utf8_bytes: usize,
    pub target_tokens: usize,
    pub max_records: usize,
}

impl ContextBudget {
    pub fn conservative_fallback(target_tokens: usize, max_records: usize) -> Self {
        // Three bytes per target token is a measured planning fallback for
        // short English memory units. The independent 4,096-byte ceiling and
        // caller's full-prompt byte guard are the enforced bounds.
        Self {
            max_utf8_bytes: target_tokens.saturating_mul(3).min(4_096),
            target_tokens,
            max_records,
        }
    }

    pub fn retrieval_options(self, query_embedding: Option<QueryEmbedding>) -> RetrievalOptions {
        RetrievalOptions {
            max_bytes: self.max_utf8_bytes,
            max_records: self.max_records,
            query_embedding,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingSource {
    pub memory_id: String,
    pub revision: i64,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryView {
    PeopleRelationships,
    EventsContext,
    SelfPreferences,
    FeelingsResponses,
    ConcernsThemes,
    GoalsSteps,
    StrengthsSupport,
}

impl MemoryView {
    pub(crate) fn from_db_value(value: &str) -> Option<Self> {
        match value {
            "people_relationships" => Some(Self::PeopleRelationships),
            "events_context" => Some(Self::EventsContext),
            "self_preferences" => Some(Self::SelfPreferences),
            "feelings_responses" => Some(Self::FeelingsResponses),
            "concerns_themes" => Some(Self::ConcernsThemes),
            "goals_steps" => Some(Self::GoalsSteps),
            "strengths_support" => Some(Self::StrengthsSupport),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct RankedCandidate {
    pub memory_id: String,
    pub lexical_rank: Option<usize>,
    pub semantic_rank: Option<usize>,
    pub fused_score: f32,
}

pub(crate) fn fuse_rankings(lexical: &[String], semantic: &[String]) -> Vec<RankedCandidate> {
    let mut candidates: HashMap<&str, RankedCandidate> = HashMap::new();
    for (index, id) in lexical.iter().enumerate() {
        let rank = index + 1;
        let entry = candidates.entry(id).or_insert_with(|| RankedCandidate {
            memory_id: id.clone(),
            lexical_rank: None,
            semantic_rank: None,
            fused_score: 0.0,
        });
        entry.lexical_rank = Some(rank);
        entry.fused_score += 1.0 / (RRF_K + rank as f32);
    }
    for (index, id) in semantic.iter().enumerate() {
        let rank = index + 1;
        let entry = candidates.entry(id).or_insert_with(|| RankedCandidate {
            memory_id: id.clone(),
            lexical_rank: None,
            semantic_rank: None,
            fused_score: 0.0,
        });
        entry.semantic_rank = Some(rank);
        entry.fused_score += 1.0 / (RRF_K + rank as f32);
    }
    let mut output: Vec<_> = candidates.into_values().collect();
    output.sort_by(|left, right| {
        right
            .fused_score
            .total_cmp(&left.fused_score)
            .then_with(|| left.memory_id.cmp(&right.memory_id))
    });
    output
}

pub(crate) fn fts_query(input: &str) -> Option<String> {
    let mut terms = Vec::new();
    for term in input
        .split(|character: char| !character.is_alphanumeric() && character != '_')
        .filter(|term| !term.is_empty())
        .take(24)
    {
        let escaped = term.replace('"', "\"\"");
        if !terms.iter().any(|existing| existing == &escaped) {
            terms.push(escaped);
        }
    }
    (!terms.is_empty()).then(|| {
        terms
            .into_iter()
            .map(|term| format!("\"{term}\""))
            .collect::<Vec<_>>()
            .join(" OR ")
    })
}

pub(crate) fn cosine_similarity(left: &[f32], right: &[f32]) -> Option<f32> {
    if left.is_empty() || left.len() != right.len() {
        return None;
    }
    let mut dot = 0.0_f64;
    let mut left_norm = 0.0_f64;
    let mut right_norm = 0.0_f64;
    for (&left, &right) in left.iter().zip(right) {
        if !left.is_finite() || !right.is_finite() {
            return None;
        }
        let left = f64::from(left);
        let right = f64::from(right);
        dot += left * right;
        left_norm += left * left;
        right_norm += right * right;
    }
    if left_norm == 0.0 || right_norm == 0.0 {
        return None;
    }
    Some((dot / (left_norm.sqrt() * right_norm.sqrt())) as f32)
}

pub(crate) fn encode_vector(vector: &[f32]) -> Option<Vec<u8>> {
    if vector.is_empty()
        || vector.len() > MAX_EMBEDDING_DIMENSIONS
        || vector.iter().any(|value| !value.is_finite())
    {
        return None;
    }
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    Some(bytes)
}

pub(crate) fn decode_vector(bytes: &[u8], dimensions: usize) -> Option<Vec<f32>> {
    if dimensions == 0
        || dimensions > MAX_EMBEDDING_DIMENSIONS
        || bytes.len() != dimensions.checked_mul(4)?
    {
        return None;
    }
    let vector: Vec<f32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect();
    vector
        .iter()
        .all(|value| value.is_finite())
        .then_some(vector)
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EmbeddingError {
    #[error("embedding endpoint is invalid")]
    InvalidEndpoint,
    #[error("embedding endpoint must be loopback HTTP with an explicit port")]
    NonLocalEndpoint,
    #[error("embedding model or input is invalid")]
    InvalidInput,
    #[error("embedding model is not installed as a local Ollama model")]
    ModelNotLocal,
    #[error("embedding request failed")]
    Network,
    #[error("embedding request timed out")]
    Timeout,
    #[error("embedding request was cancelled")]
    Cancelled,
    #[error("embedding provider returned HTTP status {0}")]
    HttpStatus(u16),
    #[error("embedding provider returned malformed data")]
    MalformedResponse,
    #[error("embedding response is too large")]
    ResponseTooLarge,
}

#[derive(Serialize)]
struct EmbedRequest<'a> {
    model: &'a str,
    input: &'a str,
    truncate: bool,
}

#[derive(Deserialize)]
struct EmbedResponse {
    model: String,
    embeddings: Vec<Vec<f32>>,
}

/// Generate one query or record embedding through an explicitly configured
/// local Ollama endpoint. This function never downloads or selects a model.
pub async fn embed_local_ollama(
    base_url: &str,
    model: &str,
    input: &str,
    cancel: &CancellationToken,
) -> Result<QueryEmbedding, EmbeddingError> {
    verify_local_ollama_model(base_url, model).await?;
    embed_local_ollama_after_verification(base_url, model, input, cancel).await
}

/// Inspect Ollama's local model inventory without running or downloading a
/// model. Models filtered as cloud-backed by the provider layer are rejected.
pub async fn verify_local_ollama_model(base_url: &str, model: &str) -> Result<(), EmbeddingError> {
    if model.trim().is_empty() || model.len() > 256 {
        return Err(EmbeddingError::InvalidInput);
    }
    let models = crate::provider::list_models(base_url)
        .await
        .map_err(|_| EmbeddingError::Network)?;
    models
        .iter()
        .any(|candidate| candidate.name == model)
        .then_some(())
        .ok_or(EmbeddingError::ModelNotLocal)
}

pub(crate) async fn embed_local_ollama_after_verification(
    base_url: &str,
    model: &str,
    input: &str,
    cancel: &CancellationToken,
) -> Result<QueryEmbedding, EmbeddingError> {
    if model.trim().is_empty()
        || model.len() > 256
        || input.trim().is_empty()
        || input.len() > MAX_EMBED_INPUT_BYTES
    {
        return Err(EmbeddingError::InvalidInput);
    }
    let url = local_api_url(base_url, "/api/embed")?;
    if cancel.is_cancelled() {
        return Err(EmbeddingError::Cancelled);
    }
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| EmbeddingError::Network)?;
    let request = client
        .post(url)
        .json(&EmbedRequest {
            model,
            input,
            truncate: false,
        })
        .build()
        .map_err(|_| EmbeddingError::Network)?;
    let response = tokio::select! {
        _ = cancel.cancelled() => return Err(EmbeddingError::Cancelled),
        response = client.execute(request) => response.map_err(|error| {
            if error.is_timeout() { EmbeddingError::Timeout } else { EmbeddingError::Network }
        })?,
    };
    if !response.status().is_success() {
        return Err(EmbeddingError::HttpStatus(response.status().as_u16()));
    }
    let bytes = response.bytes().await.map_err(|error| {
        if error.is_timeout() {
            EmbeddingError::Timeout
        } else {
            EmbeddingError::Network
        }
    })?;
    if bytes.len() > MAX_EMBED_RESPONSE_BYTES {
        return Err(EmbeddingError::ResponseTooLarge);
    }
    let mut response: EmbedResponse =
        serde_json::from_slice(&bytes).map_err(|_| EmbeddingError::MalformedResponse)?;
    if response.model != model || response.embeddings.len() != 1 {
        return Err(EmbeddingError::MalformedResponse);
    }
    let vector = response.embeddings.pop().expect("one embedding");
    if encode_vector(&vector).is_none() {
        return Err(EmbeddingError::MalformedResponse);
    }
    Ok(QueryEmbedding {
        model: response.model,
        vector,
    })
}

fn local_api_url(base_url: &str, path: &str) -> Result<Url, EmbeddingError> {
    let mut url = Url::parse(base_url).map_err(|_| EmbeddingError::InvalidEndpoint)?;
    if url.scheme() != "http"
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || (url.path() != "" && url.path() != "/")
    {
        return Err(EmbeddingError::NonLocalEndpoint);
    }
    let port = url.port().ok_or(EmbeddingError::NonLocalEndpoint)?;
    let mut resolved = None;
    match url.host().ok_or(EmbeddingError::InvalidEndpoint)? {
        Host::Ipv4(address) if address.is_loopback() => {}
        Host::Ipv6(address) if address.is_loopback() => {}
        Host::Domain(domain) if domain.eq_ignore_ascii_case("localhost") => {
            let addresses = (domain, port)
                .to_socket_addrs()
                .map_err(|_| EmbeddingError::NonLocalEndpoint)?;
            for address in addresses {
                if !address.ip().is_loopback() {
                    return Err(EmbeddingError::NonLocalEndpoint);
                }
                resolved.get_or_insert(address.ip());
            }
            if resolved.is_none() {
                return Err(EmbeddingError::NonLocalEndpoint);
            }
        }
        _ => return Err(EmbeddingError::NonLocalEndpoint),
    }
    if let Some(address) = resolved {
        let host = match address {
            IpAddr::V4(address) => address.to_string(),
            IpAddr::V6(address) => format!("[{address}]"),
        };
        url.set_host(Some(&host))
            .map_err(|_| EmbeddingError::InvalidEndpoint)?;
    }
    url.set_path(path);
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn fts_query_treats_syntax_as_plain_terms_and_preserves_negation() {
        assert_eq!(
            fts_query("Mira is NOT my sister (coworker)"),
            Some("\"Mira\" OR \"is\" OR \"NOT\" OR \"my\" OR \"sister\" OR \"coworker\"".into())
        );
        assert_eq!(fts_query("!*"), None);
    }

    #[test]
    fn reciprocal_rank_fusion_rewards_agreement() {
        let ranked = fuse_rankings(
            &["lexical".into(), "both".into()],
            &["both".into(), "semantic".into()],
        );
        assert_eq!(ranked[0].memory_id, "both");
        assert_eq!(ranked[0].lexical_rank, Some(2));
        assert_eq!(ranked[0].semantic_rank, Some(1));
    }

    #[test]
    fn vector_round_trip_and_cosine_are_bounded() {
        let vector = vec![0.5, -1.25, 2.0];
        let bytes = encode_vector(&vector).expect("valid vector");
        assert_eq!(decode_vector(&bytes, 3), Some(vector));
        assert_eq!(cosine_similarity(&[1.0, 0.0], &[1.0, 0.0]), Some(1.0));
        assert!(cosine_similarity(&[1.0], &[1.0, 2.0]).is_none());
    }

    #[test]
    fn context_budget_exposes_estimate_but_enforces_a_byte_ceiling() {
        let budget = ContextBudget::conservative_fallback(1_200, 8);
        assert_eq!(budget.target_tokens, 1_200);
        assert_eq!(budget.max_utf8_bytes, 3_600);
        assert_eq!(
            ContextBudget::conservative_fallback(2_000, 8).max_utf8_bytes,
            4_096
        );
    }

    #[test]
    fn embedding_url_rejects_remote_and_nested_endpoints() {
        assert!(local_api_url("http://127.0.0.1:11434", "/api/embed").is_ok());
        assert!(local_api_url("https://127.0.0.1:11434", "/api/embed").is_err());
        assert!(local_api_url("http://example.com:11434", "/api/embed").is_err());
        assert!(local_api_url("http://127.0.0.1:11434/api", "/api/embed").is_err());
    }

    #[tokio::test]
    async fn local_embedding_call_uses_ollama_protocol_without_truncation() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local fixture");
        let address = listener.local_addr().expect("fixture address");
        let handle = tokio::spawn(async move {
            for request_index in 0..2 {
                let (mut stream, _) = listener.accept().await.expect("accept request");
                let mut request = vec![0_u8; 8 * 1024];
                let bytes = stream.read(&mut request).await.expect("read request");
                let request = String::from_utf8(request[..bytes].to_vec()).expect("utf8 request");
                let body: &[u8] = if request_index == 0 {
                    assert!(request.starts_with("GET /api/tags HTTP/1.1"));
                    br#"{"models":[{"name":"synthetic-embed","size":42}]}"#
                } else {
                    assert!(request.starts_with("POST /api/embed HTTP/1.1"));
                    assert!(request.contains("\"model\":\"synthetic-embed\""));
                    assert!(request.contains("\"input\":\"query text\""));
                    assert!(request.contains("\"truncate\":false"));
                    br#"{"model":"synthetic-embed","embeddings":[[0.25,-0.5,1.0]]}"#
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream
                    .write_all(response.as_bytes())
                    .await
                    .expect("write headers");
                stream.write_all(body).await.expect("write body");
            }
        });

        let result = embed_local_ollama(
            &format!("http://{address}"),
            "synthetic-embed",
            "query text",
            &CancellationToken::new(),
        )
        .await
        .expect("generate embedding");
        assert_eq!(result.model, "synthetic-embed");
        assert_eq!(result.vector, vec![0.25, -0.5, 1.0]);
        handle.await.expect("fixture task");
    }
}
