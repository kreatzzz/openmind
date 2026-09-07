//! Bounded Ollama access for the first local provider prototype.
//!
//! This module deliberately accepts only an explicitly configured HTTP
//! loopback endpoint. That check protects the application from accidentally
//! sending a conversation to a remote host, but it cannot prove what an
//! independently managed Ollama process does with the text it receives.

use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

use reqwest::{Client, Request, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio_util::sync::CancellationToken;
use url::Host;

/// The small system prompt used by the prototype Ollama adapter.
///
/// Output is passed through as emitted by Ollama. This provider does not
/// classify or rewrite model text, and the prompt is not a clinical safety
/// guarantee.
pub const SYSTEM_PROMPT: &str = "You are Openmind's experimental AI assistant. This prototype has not been clinically validated. Do not present yourself as a clinician, therapist, doctor, or emergency service. Be clear that you are an AI when that matters. Respond to the user's words plainly and preserve their meaning. If the user may be in immediate danger, encourage them to contact local emergency services or a trusted person.";

const MAX_BASE_URL_BYTES: usize = 2 * 1024;
const MAX_MODEL_BYTES: usize = 256;
const MAX_MESSAGES: usize = 128;
const MAX_MESSAGE_BYTES: usize = 64 * 1024;
// The local engine reserves 1,024 output tokens from an 8,192-token context.
// Six thousand UTF-8 bytes is a conservative upper bound for the history;
// the separate prompt cap leaves room for the fixed system message and JSON
// framing while remaining below the remaining context budget.
const MAX_HISTORY_BYTES: usize = 6_000;
const MAX_PROMPT_BYTES: usize = 7_000;
const MAX_REQUEST_BYTES: usize = 768 * 1024;
const MAX_MODELS: usize = 256;
const MAX_TAGS_BODY_BYTES: usize = 4 * 1024 * 1024;
const MAX_SHOW_BODY_BYTES: usize = 1024 * 1024;
const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;
const MAX_FRAME_BYTES: usize = 256 * 1024;
const MAX_FRAMES: usize = 16 * 1024;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);

const MODEL_CONTEXT_TOKENS: u32 = 8_192;
const MAX_PREDICT_TOKENS: u32 = 1_024;

/// A model exposed by Ollama's `/api/tags` endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub size: u64,
}

/// A message in the bounded native Ollama chat request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// A callback item emitted by [`generate`].
pub type Chunk = Result<String, ProviderError>;

/// A synchronous sink suitable for a bridge that appends chunks to a vault
/// transaction. Returning an error stops the request. In particular, a
/// caller can return [`ProviderError::CallbackFailed`] when a locked vault
/// prevents it from accepting another chunk.
pub type ChunkCallback = Box<dyn FnMut(Chunk) -> Result<(), ProviderError> + Send>;

/// Errors exposed by the local provider.
///
/// Variants intentionally do not retain request URLs, response bodies, model
/// output, or transport error strings. Those values can contain conversation
/// text, credentials, or an endpoint supplied by another process.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ProviderError {
    #[error("provider base URL is invalid")]
    InvalidBaseUrl,
    #[error("provider base URL must use HTTP")]
    UnsupportedScheme,
    #[error("provider base URL must include a valid port")]
    InvalidPort,
    #[error("provider base URL may not contain a path")]
    BaseUrlPath,
    #[error("provider base URL may not contain a query or fragment")]
    BaseUrlQuery,
    #[error("provider base URL may not contain user information")]
    BaseUrlUserInfo,
    #[error("provider endpoint must resolve to a loopback address")]
    NonLoopbackHost,
    #[error("provider request is too large")]
    RequestTooLarge,
    #[error("provider history is too large")]
    HistoryTooLarge,
    #[error("provider message is invalid")]
    InvalidMessage,
    #[error("provider model is invalid")]
    InvalidModel,
    #[error("cloud-backed models are not allowed in local mode")]
    CloudModelRejected,
    #[error("provider metadata does not identify a local model")]
    RemoteModelRejected,
    #[error("provider returned HTTP status {0}")]
    HttpStatus(u16),
    #[error("provider connection failed")]
    Network,
    #[error("provider request timed out")]
    Timeout,
    #[error("provider request was cancelled")]
    Cancelled,
    #[error("provider response is too large")]
    ResponseTooLarge,
    #[error("provider stream frame is too large")]
    FrameTooLarge,
    #[error("provider stream is too large")]
    StreamTooLarge,
    #[error("provider returned malformed data")]
    MalformedResponse,
    #[error("provider returned invalid UTF-8")]
    InvalidUtf8,
    #[error("provider stream ended before done=true")]
    TruncatedStream,
    #[error("provider stream violated its protocol")]
    Protocol,
    #[error("provider reported an error")]
    ProviderReportedError,
    #[error("provider returned an empty response")]
    EmptyResponse,
    #[error("provider callback failed")]
    CallbackFailed,
}

#[derive(Debug, Clone)]
struct Endpoint {
    base: Url,
}

impl Endpoint {
    fn parse(raw: &str) -> Result<Self, ProviderError> {
        if raw.is_empty() || raw.len() > MAX_BASE_URL_BYTES {
            return Err(ProviderError::InvalidBaseUrl);
        }

        let mut url = Url::parse(raw).map_err(|_| ProviderError::InvalidBaseUrl)?;
        if url.scheme() != "http" {
            return Err(ProviderError::UnsupportedScheme);
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err(ProviderError::BaseUrlUserInfo);
        }
        if url.query().is_some() || url.fragment().is_some() {
            return Err(ProviderError::BaseUrlQuery);
        }
        if url.path() != "" && url.path() != "/" {
            return Err(ProviderError::BaseUrlPath);
        }

        let port = url.port().ok_or(ProviderError::InvalidPort)?;
        if port == 0 {
            return Err(ProviderError::InvalidPort);
        }

        let host = url.host().ok_or(ProviderError::InvalidBaseUrl)?;
        let mut resolved_localhost = None;
        match host {
            Host::Ipv4(address) if address.is_loopback() => {}
            Host::Ipv6(address) if address.is_loopback() => {}
            Host::Domain(domain) if domain.eq_ignore_ascii_case("localhost") => {
                // Hostname spelling alone is not a locality proof. Resolve
                // localhost and require every answer to be loopback before
                // allowing reqwest to use it.
                let addresses = (domain, port)
                    .to_socket_addrs()
                    .map_err(|_| ProviderError::NonLoopbackHost)?;
                let mut found = false;
                let mut first_loopback = None;
                for address in addresses {
                    found = true;
                    if !address.ip().is_loopback() {
                        return Err(ProviderError::NonLoopbackHost);
                    }
                    if first_loopback.is_none() {
                        first_loopback = Some(address.ip());
                    }
                }
                if !found {
                    return Err(ProviderError::NonLoopbackHost);
                }
                resolved_localhost = first_loopback;
            }
            _ => return Err(ProviderError::NonLoopbackHost),
        }

        // Pin localhost to the loopback answer checked above. This avoids a
        // DNS result changing between validation and the actual request.
        if let Some(address) = resolved_localhost {
            let host = match address {
                IpAddr::V4(address) => address.to_string(),
                IpAddr::V6(address) => format!("[{address}]"),
            };
            url.set_host(Some(&host))
                .map_err(|_| ProviderError::InvalidBaseUrl)?;
        }

        Ok(Self { base: url })
    }

    fn api(&self, path: &str) -> Url {
        let mut url = self.base.clone();
        url.set_path(path);
        url
    }
}

fn build_client() -> Result<Client, ProviderError> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_| ProviderError::Network)
}

/// List locally available models from Ollama.
///
/// The list endpoint is filtered for explicit cloud or remote metadata. It
/// does not claim that an independently managed Ollama process is offline.
pub async fn list_models(base_url: &str) -> Result<Vec<ModelInfo>, ProviderError> {
    let endpoint = Endpoint::parse(base_url)?;
    let client = build_client()?;
    let request = client
        .get(endpoint.api("/api/tags"))
        .build()
        .map_err(|_| ProviderError::Network)?;
    let response = client.execute(request).await.map_err(map_request_error)?;
    ensure_success(&response)?;
    let body = read_response_body(response, MAX_TAGS_BODY_BYTES, None).await?;
    parse_model_list(&body)
}

/// Generate a streamed native Ollama chat response.
///
/// Each generated content fragment is delivered once as `Ok(String)`. A
/// cancellation or provider failure is delivered once as `Err` and returned
/// from this function. If the callback itself returns an error, that error is
/// returned directly and is not sent back through the callback a second time.
pub async fn generate<F>(
    base_url: &str,
    model: &str,
    history: Vec<ChatMessage>,
    cancel: CancellationToken,
    mut callback: F,
) -> Result<(), ProviderError>
where
    F: FnMut(Chunk) -> Result<(), ProviderError> + Send,
{
    let endpoint = match Endpoint::parse(base_url) {
        Ok(endpoint) => endpoint,
        Err(error) => return Err(notify_failure(&mut callback, error)),
    };
    if cancel.is_cancelled() {
        return Err(notify_failure(&mut callback, ProviderError::Cancelled));
    }
    if let Err(error) = validate_model_name(model) {
        return Err(notify_failure(&mut callback, error));
    }
    if is_known_cloud_model(model) {
        return Err(notify_failure(
            &mut callback,
            ProviderError::CloudModelRejected,
        ));
    }

    let messages = match prepare_history(history) {
        Ok(messages) => messages,
        Err(error) => return Err(notify_failure(&mut callback, error)),
    };
    let client = match build_client() {
        Ok(client) => client,
        Err(error) => return Err(notify_failure(&mut callback, error)),
    };

    // Ollama documents /api/show for model metadata. Older compatible
    // runtimes may not implement it, so a 404/405 means that locality could
    // not be inspected. A positive remote/cloud marker still rejects the
    // model before any chat history is sent.
    if let Err(error) = probe_model_metadata(&client, &endpoint, model, &cancel).await {
        return Err(notify_failure(&mut callback, error));
    }

    let body = ChatRequest {
        model,
        messages: &messages,
        stream: true,
        options: ChatOptions {
            num_ctx: MODEL_CONTEXT_TOKENS,
            num_predict: MAX_PREDICT_TOKENS,
        },
    };
    let encoded = match serde_json::to_vec(&body) {
        Ok(encoded) if encoded.len() <= MAX_REQUEST_BYTES => encoded,
        Ok(_) => {
            return Err(notify_failure(
                &mut callback,
                ProviderError::RequestTooLarge,
            ))
        }
        Err(_) => {
            return Err(notify_failure(
                &mut callback,
                ProviderError::MalformedResponse,
            ))
        }
    };
    let request = match client
        .post(endpoint.api("/api/chat"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(encoded)
        .build()
    {
        Ok(request) => request,
        Err(_) => return Err(notify_failure(&mut callback, ProviderError::Network)),
    };
    let mut response = match execute_with_cancel(&client, request, &cancel).await {
        Ok(response) => response,
        Err(error) => return Err(notify_failure(&mut callback, error)),
    };
    if let Err(error) = ensure_success(&response) {
        return Err(notify_failure(&mut callback, error));
    }

    let mut parser = NdjsonParser::default();
    let mut emitted_non_whitespace = false;
    loop {
        let next = tokio::select! {
            _ = cancel.cancelled() => {
                return Err(notify_failure(&mut callback, ProviderError::Cancelled));
            }
            result = tokio::time::timeout(IDLE_TIMEOUT, response.chunk()) => result,
        };
        let chunk = match next {
            Err(_) => return Err(notify_failure(&mut callback, ProviderError::Timeout)),
            Ok(Err(_)) => return Err(notify_failure(&mut callback, ProviderError::Network)),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(chunk))) => chunk,
        };

        let pieces = match parser.feed(&chunk) {
            Ok(pieces) => pieces,
            Err(error) => return Err(notify_failure(&mut callback, error)),
        };
        for piece in pieces {
            emitted_non_whitespace |= !piece.trim().is_empty();
            callback(Ok(piece))?;
        }
    }

    let pieces = match parser.finish() {
        Ok(pieces) => pieces,
        Err(error) => return Err(notify_failure(&mut callback, error)),
    };
    for piece in pieces {
        emitted_non_whitespace |= !piece.trim().is_empty();
        callback(Ok(piece))?;
    }
    if !emitted_non_whitespace {
        return Err(notify_failure(&mut callback, ProviderError::EmptyResponse));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
    options: ChatOptions,
}

#[derive(Debug, Serialize)]
struct ChatOptions {
    num_ctx: u32,
    num_predict: u32,
}

fn validate_model_name(model: &str) -> Result<(), ProviderError> {
    if model.is_empty()
        || model.len() > MAX_MODEL_BYTES
        || model.chars().any(|character| character.is_control())
    {
        return Err(ProviderError::InvalidModel);
    }
    Ok(())
}

fn is_known_cloud_model(model: &str) -> bool {
    model
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| part.eq_ignore_ascii_case("cloud"))
}

fn prepare_history(history: Vec<ChatMessage>) -> Result<Vec<ChatMessage>, ProviderError> {
    if history.len() > MAX_MESSAGES {
        return Err(ProviderError::HistoryTooLarge);
    }

    let mut history_bytes = 0usize;
    let mut total_bytes = SYSTEM_PROMPT.len();
    let mut messages = Vec::with_capacity(history.len() + 1);
    messages.push(ChatMessage {
        role: "system".to_owned(),
        content: SYSTEM_PROMPT.to_owned(),
    });

    for message in history {
        if message.role != "user" && message.role != "assistant" {
            return Err(ProviderError::InvalidMessage);
        }
        if message.content.len() > MAX_MESSAGE_BYTES {
            return Err(ProviderError::HistoryTooLarge);
        }
        history_bytes = history_bytes
            .checked_add(message.content.len())
            .ok_or(ProviderError::HistoryTooLarge)?;
        if history_bytes > MAX_HISTORY_BYTES {
            return Err(ProviderError::HistoryTooLarge);
        }
        total_bytes = total_bytes
            .checked_add(message.role.len())
            .and_then(|value| value.checked_add(message.content.len()))
            .ok_or(ProviderError::HistoryTooLarge)?;
        if total_bytes > MAX_PROMPT_BYTES {
            return Err(ProviderError::HistoryTooLarge);
        }
        messages.push(message);
    }
    Ok(messages)
}

fn map_request_error(error: reqwest::Error) -> ProviderError {
    if error.is_timeout() {
        ProviderError::Timeout
    } else {
        ProviderError::Network
    }
}

fn ensure_success(response: &Response) -> Result<(), ProviderError> {
    if response.status().is_success() {
        Ok(())
    } else {
        Err(ProviderError::HttpStatus(response.status().as_u16()))
    }
}

async fn execute_with_cancel(
    client: &Client,
    request: Request,
    cancel: &CancellationToken,
) -> Result<Response, ProviderError> {
    if cancel.is_cancelled() {
        return Err(ProviderError::Cancelled);
    }
    tokio::select! {
        _ = cancel.cancelled() => Err(ProviderError::Cancelled),
        result = client.execute(request) => result.map_err(map_request_error),
    }
}

async fn read_response_body(
    mut response: Response,
    max_bytes: usize,
    cancel: Option<&CancellationToken>,
) -> Result<Vec<u8>, ProviderError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(ProviderError::ResponseTooLarge);
    }

    let capacity = response
        .content_length()
        .map(|length| length.min(max_bytes as u64) as usize)
        .unwrap_or(0);
    let mut body = Vec::with_capacity(capacity);
    loop {
        let next = if let Some(cancel) = cancel {
            tokio::select! {
                _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
                result = tokio::time::timeout(IDLE_TIMEOUT, response.chunk()) => result,
            }
        } else {
            tokio::time::timeout(IDLE_TIMEOUT, response.chunk()).await
        };
        let chunk = match next {
            Err(_) => return Err(ProviderError::Timeout),
            Ok(Err(_)) => return Err(ProviderError::Network),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(chunk))) => chunk,
        };
        if body
            .len()
            .checked_add(chunk.len())
            .is_none_or(|length| length > max_bytes)
        {
            return Err(ProviderError::ResponseTooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn parse_model_list(body: &[u8]) -> Result<Vec<ModelInfo>, ProviderError> {
    let value: Value =
        serde_json::from_slice(body).map_err(|_| ProviderError::MalformedResponse)?;
    let models = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or(ProviderError::MalformedResponse)?;
    if models.len() > MAX_MODELS {
        return Err(ProviderError::ResponseTooLarge);
    }

    let mut output = Vec::with_capacity(models.len());
    for model in models {
        let object = model.as_object().ok_or(ProviderError::MalformedResponse)?;
        let name = object
            .get("name")
            .or_else(|| object.get("model"))
            .and_then(Value::as_str)
            .ok_or(ProviderError::MalformedResponse)?;
        validate_model_name(name)?;
        if is_known_cloud_model(name) || metadata_indicates_remote(model) {
            continue;
        }
        let size = match object.get("size") {
            Some(value) => value.as_u64().ok_or(ProviderError::MalformedResponse)?,
            None => 0,
        };
        output.push(ModelInfo {
            name: name.to_owned(),
            size,
        });
    }
    Ok(output)
}

async fn probe_model_metadata(
    client: &Client,
    endpoint: &Endpoint,
    model: &str,
    cancel: &CancellationToken,
) -> Result<(), ProviderError> {
    let payload = serde_json::json!({ "model": model });
    let encoded = serde_json::to_vec(&payload).map_err(|_| ProviderError::MalformedResponse)?;
    let request = client
        .post(endpoint.api("/api/show"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(encoded)
        .build()
        .map_err(|_| ProviderError::Network)?;
    let response = execute_with_cancel(client, request, cancel).await?;
    if response.status() == StatusCode::NOT_FOUND
        || response.status() == StatusCode::METHOD_NOT_ALLOWED
    {
        return Ok(());
    }
    ensure_success(&response)?;
    let body = read_response_body(response, MAX_SHOW_BODY_BYTES, Some(cancel)).await?;
    let value: Value =
        serde_json::from_slice(&body).map_err(|_| ProviderError::MalformedResponse)?;
    if metadata_indicates_remote(&value) {
        return Err(ProviderError::RemoteModelRejected);
    }
    if value.get("error").is_some_and(|error| !error.is_null()) {
        return Err(ProviderError::ProviderReportedError);
    }
    Ok(())
}

/// Inspect only explicit metadata flags. A missing flag is left unknown. A
/// loopback URL does not turn an unknown model execution location into a
/// verified local claim.
fn metadata_indicates_remote(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, child)| {
            let key = key.to_ascii_lowercase();
            if matches!(
                key.as_str(),
                "remote" | "cloud" | "cloud_model" | "remote_model" | "remote_host"
            ) && metadata_flag_is_true(&key, child)
            {
                return true;
            }
            metadata_indicates_remote(child)
        }),
        Value::Array(array) => array.iter().any(metadata_indicates_remote),
        _ => false,
    }
}

fn metadata_flag_is_true(key: &str, value: &Value) -> bool {
    match value {
        Value::Bool(value) => *value,
        Value::String(value) => {
            (key == "remote_model" || key == "remote_host") && !value.is_empty()
        }
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
        _ => false,
    }
}

fn notify_failure<F>(callback: &mut F, error: ProviderError) -> ProviderError
where
    F: FnMut(Chunk) -> Result<(), ProviderError>,
{
    match callback(Err(error.clone())) {
        Ok(()) => error,
        Err(callback_error) => callback_error,
    }
}

#[derive(Debug, Default)]
struct NdjsonParser {
    buffer: Vec<u8>,
    total_bytes: usize,
    frames: usize,
    saw_done: bool,
}

impl NdjsonParser {
    fn feed(&mut self, bytes: &[u8]) -> Result<Vec<String>, ProviderError> {
        self.total_bytes = self
            .total_bytes
            .checked_add(bytes.len())
            .ok_or(ProviderError::StreamTooLarge)?;
        if self.total_bytes > MAX_STREAM_BYTES {
            return Err(ProviderError::StreamTooLarge);
        }

        let mut pieces = Vec::new();
        for byte in bytes {
            self.buffer.push(*byte);
            if self.buffer.len() > MAX_FRAME_BYTES {
                return Err(ProviderError::FrameTooLarge);
            }
            if *byte == b'\n' {
                let line = std::mem::take(&mut self.buffer);
                self.process_line(&line, &mut pieces)?;
            }
        }
        Ok(pieces)
    }

    fn finish(&mut self) -> Result<Vec<String>, ProviderError> {
        let mut pieces = Vec::new();
        if !self.buffer.is_empty() {
            let line = std::mem::take(&mut self.buffer);
            self.process_line(&line, &mut pieces)?;
        }
        if !self.saw_done {
            return Err(ProviderError::TruncatedStream);
        }
        Ok(pieces)
    }

    fn process_line(&mut self, line: &[u8], pieces: &mut Vec<String>) -> Result<(), ProviderError> {
        let line = line.strip_suffix(b"\n").unwrap_or(line);
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line.iter().all(u8::is_ascii_whitespace) {
            return Ok(());
        }
        if self.saw_done {
            return Err(ProviderError::Protocol);
        }
        self.frames = self
            .frames
            .checked_add(1)
            .ok_or(ProviderError::FrameTooLarge)?;
        if self.frames > MAX_FRAMES {
            return Err(ProviderError::FrameTooLarge);
        }
        if std::str::from_utf8(line).is_err() {
            return Err(ProviderError::InvalidUtf8);
        }

        let frame: StreamFrame =
            serde_json::from_slice(line).map_err(|_| ProviderError::MalformedResponse)?;
        if frame.error.as_ref().is_some_and(|error| !error.is_null()) {
            return Err(ProviderError::ProviderReportedError);
        }
        let done = frame.done.ok_or(ProviderError::Protocol)?;
        if let Some(message) = frame.message {
            if let Some(content) = message.content {
                if !content.is_empty() {
                    pieces.push(content);
                }
            }
        }
        if done {
            self.saw_done = true;
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct StreamFrame {
    done: Option<bool>,
    #[serde(default)]
    message: Option<StreamMessage>,
    #[serde(default)]
    error: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct StreamMessage {
    #[serde(default)]
    content: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread::{self, JoinHandle};

    fn feed_in_arbitrary_splits(
        input: &[u8],
        splits: &[usize],
    ) -> Result<Vec<String>, ProviderError> {
        let mut parser = NdjsonParser::default();
        let mut chunks = Vec::new();
        let mut offset = 0;
        for size in splits {
            let end = (offset + size).min(input.len());
            chunks.extend(parser.feed(&input[offset..end])?);
            offset = end;
            if offset == input.len() {
                break;
            }
        }
        if offset < input.len() {
            chunks.extend(parser.feed(&input[offset..])?);
        }
        chunks.extend(parser.finish()?);
        Ok(chunks)
    }

    #[test]
    fn parser_handles_utf8_and_frames_split_at_every_byte() {
        let input = b"{\"message\":{\"content\":\"caf\xc3\xa9\"},\"done\":false}\n\
{\"message\":{\"content\":\" fin\"},\"done\":false}\n\
{\"done\":true}\n";
        let splits: Vec<usize> = (1..=input.len()).collect();
        let chunks = feed_in_arbitrary_splits(input, &splits).expect("valid stream");
        assert_eq!(chunks, vec!["café".to_owned(), " fin".to_owned()]);
    }

    #[test]
    fn parser_rejects_malformed_frame() {
        let mut parser = NdjsonParser::default();
        let error = parser
            .feed(b"{\"done\":false,\"message\":{\"content\":}}\n")
            .unwrap_err();
        assert_eq!(error, ProviderError::MalformedResponse);
    }

    #[test]
    fn parser_rejects_oversized_frame() {
        let mut parser = NdjsonParser::default();
        let error = parser.feed(&vec![b'x'; MAX_FRAME_BYTES + 1]).unwrap_err();
        assert_eq!(error, ProviderError::FrameTooLarge);
    }

    #[test]
    fn parser_rejects_error_frame_without_echoing_body() {
        let mut parser = NdjsonParser::default();
        let error = parser
            .feed(b"{\"error\":\"private response text\",\"done\":true}\n")
            .unwrap_err();
        assert_eq!(error, ProviderError::ProviderReportedError);
    }

    #[test]
    fn parser_requires_done_frame() {
        let mut parser = NdjsonParser::default();
        parser
            .feed(b"{\"message\":{\"content\":\"partial\"},\"done\":false}\n")
            .expect("partial frame is valid");
        assert_eq!(parser.finish().unwrap_err(), ProviderError::TruncatedStream);
    }

    #[test]
    fn parser_emits_each_native_chunk_once() {
        let chunks = feed_in_arbitrary_splits(
            br#"{"message":{"content":"one"},"done":false}
{"done":true}
"#,
            &[3, 2, 7, 1, 4],
        )
        .expect("valid stream");
        assert_eq!(chunks, vec!["one".to_owned()]);
    }

    #[test]
    fn base_url_accepts_literal_loopback_and_rejects_remote_or_ambiguous_urls() {
        assert!(Endpoint::parse("http://127.0.0.1:11434").is_ok());
        assert!(Endpoint::parse("http://[::1]:11434").is_ok());
        let localhost = Endpoint::parse("http://localhost:11434").expect("localhost is loopback");
        assert!(match localhost.base.host() {
            Some(Host::Ipv4(address)) => address.is_loopback(),
            Some(Host::Ipv6(address)) => address.is_loopback(),
            _ => false,
        });
        assert!(Endpoint::parse("http://example.com:11434").is_err());
        assert!(Endpoint::parse("http://127.0.0.1:11434/api").is_err());
        assert!(Endpoint::parse("http://127.0.0.1:11434?x=1").is_err());
        assert!(Endpoint::parse("http://user@127.0.0.1:11434").is_err());
        assert!(Endpoint::parse("https://127.0.0.1:11434").is_err());
        assert!(Endpoint::parse("http://127.0.0.1:0").is_err());
        assert!(Endpoint::parse("http://127.0.0.1").is_err());
    }

    #[test]
    fn model_list_filters_explicit_cloud_metadata() {
        let body = br#"{"models":[
          {"name":"llama3.2:latest","size":123},
          {"name":"qwen3:cloud","size":456},
          {"name":"remote-model","size":789,"remote":true}
        ]}"#;
        let models = parse_model_list(body).expect("valid model list");
        assert_eq!(
            models,
            vec![ModelInfo {
                name: "llama3.2:latest".to_owned(),
                size: 123,
            }]
        );
    }

    #[test]
    fn chat_request_sets_explicit_context_and_output_bounds() {
        let messages = vec![ChatMessage {
            role: "user".to_owned(),
            content: "synthetic".to_owned(),
        }];
        let request = serde_json::to_value(ChatRequest {
            model: "llama3.2",
            messages: &messages,
            stream: true,
            options: ChatOptions {
                num_ctx: MODEL_CONTEXT_TOKENS,
                num_predict: MAX_PREDICT_TOKENS,
            },
        })
        .expect("request serializes");
        assert_eq!(request["stream"], true);
        assert_eq!(request["options"]["num_ctx"], MODEL_CONTEXT_TOKENS);
        assert_eq!(request["options"]["num_predict"], MAX_PREDICT_TOKENS);
    }

    #[test]
    fn history_is_rejected_before_request_serialization_when_over_budget() {
        let history = vec![ChatMessage {
            role: "user".to_owned(),
            content: "x".repeat(MAX_HISTORY_BYTES + 1),
        }];
        assert_eq!(
            prepare_history(history).unwrap_err(),
            ProviderError::HistoryTooLarge
        );
    }

    #[tokio::test]
    async fn list_models_uses_an_ephemeral_http_fixture() {
        let response = http_response(br#"{"models":[{"name":"llama3.2","size":42}]}"#);
        let (base_url, handle) = spawn_http_fixture(vec![response]);
        let models = list_models(&base_url).await.expect("fixture response");
        handle.join().expect("fixture exits");
        assert_eq!(models[0].name, "llama3.2");
        assert_eq!(models[0].size, 42);
    }

    #[tokio::test]
    async fn generate_probes_show_then_streams_chat_and_preserves_text() {
        let show = http_response(br#"{"details":{"family":"llama"}}"#);
        let chat = http_response(
            b"{\"message\":{\"role\":\"assistant\",\"content\":\"a\"},\"done\":false}\n\
{\"message\":{\"role\":\"assistant\",\"content\":\"\xc3\xa9\"},\"done\":false}\n\
{\"done\":true}\n",
        );
        let (base_url, handle) = spawn_http_fixture(vec![show, chat]);
        let mut chunks = Vec::new();
        let cancel = CancellationToken::new();
        generate(
            &base_url,
            "llama3.2",
            vec![ChatMessage {
                role: "user".to_owned(),
                content: "hello".to_owned(),
            }],
            cancel,
            |item| {
                chunks.push(item);
                Ok(())
            },
        )
        .await
        .expect("fixture generation");
        handle.join().expect("fixture exits");
        assert_eq!(chunks, vec![Ok("a".to_owned()), Ok("é".to_owned())]);
    }

    #[tokio::test]
    async fn generate_rejects_done_stream_without_visible_text() {
        let show = http_response(br#"{"details":{"family":"llama"}}"#);
        let chat = http_response(
            br#"{"message":{"role":"assistant","content":""},"done":true}
"#,
        );
        let (base_url, handle) = spawn_http_fixture(vec![show, chat]);
        let mut events = Vec::new();
        let result = generate(
            &base_url,
            "llama3.2",
            vec![ChatMessage {
                role: "user".to_owned(),
                content: "hello".to_owned(),
            }],
            CancellationToken::new(),
            |item| {
                events.push(item);
                Ok(())
            },
        )
        .await;
        handle.join().expect("fixture exits");
        assert_eq!(result, Err(ProviderError::EmptyResponse));
        assert_eq!(events, vec![Err(ProviderError::EmptyResponse)]);
    }

    #[tokio::test]
    async fn cancelled_generation_notifies_callback_once() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        let mut events = Vec::new();
        let result = generate(
            "http://127.0.0.1:11434",
            "llama3.2",
            Vec::new(),
            cancel,
            |item| {
                events.push(item);
                Ok(())
            },
        )
        .await;
        assert_eq!(result, Err(ProviderError::Cancelled));
        assert_eq!(events, vec![Err(ProviderError::Cancelled)]);
    }

    #[tokio::test]
    #[ignore = "requires an explicitly started local Ollama fixture"]
    async fn live_ollama_streams_synthetic_response() {
        let base_url = std::env::var("OPENMIND_TEST_OLLAMA_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:11439".to_owned());
        let model =
            std::env::var("OPENMIND_TEST_MODEL").unwrap_or_else(|_| "gemma3:270m".to_owned());
        let mut chunks = Vec::new();
        let mut errors = Vec::new();
        let result = generate(
            &base_url,
            &model,
            vec![ChatMessage {
                role: "user".to_owned(),
                content: "Synthetic provider smoke test. Reply with one short sentence.".to_owned(),
            }],
            CancellationToken::new(),
            |item| {
                match item {
                    Ok(chunk) => chunks.push(chunk),
                    Err(error) => errors.push(error),
                }
                Ok(())
            },
        )
        .await;
        assert!(result.is_ok(), "local Ollama request failed");
        assert!(errors.is_empty(), "stream emitted a provider error");
        assert!(!chunks.concat().trim().is_empty(), "stream was empty");
    }

    fn http_response(body: &[u8]) -> Vec<u8> {
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let mut response = header.into_bytes();
        response.extend_from_slice(body);
        response
    }

    fn spawn_http_fixture(responses: Vec<Vec<u8>>) -> (String, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture");
        let port = listener.local_addr().expect("fixture address").port();
        let handle = thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().expect("accept fixture request");
                read_headers(&mut stream);
                stream.write_all(&response).expect("write fixture response");
                let _ = stream.shutdown(std::net::Shutdown::Both);
            }
        });
        (format!("http://127.0.0.1:{port}"), handle)
    }

    fn read_headers(stream: &mut TcpStream) {
        let mut buffer = [0u8; 1024];
        let mut request = Vec::new();
        loop {
            let bytes = stream.read(&mut buffer).expect("read fixture request");
            if bytes == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..bytes]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
            if request.len() > 64 * 1024 {
                break;
            }
        }
    }
}
