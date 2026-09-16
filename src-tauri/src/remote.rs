//! Explicit BYOK adapter for OpenAI-compatible chat-completions servers.
//!
//! The caller must enforce persisted remote-data consent before invoking this
//! module. Credentials are accepted only for the duration of a request and are
//! never included in errors or returned values.

use std::{net::IpAddr, time::Duration};

use futures_util::StreamExt;
use reqwest::{Client, Response, Url};
use serde::Serialize;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use crate::{
    notes::NotePatch,
    provider::{self, ChatMessage, Chunk, ProviderError},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_FRAME_BYTES: usize = 256 * 1024;
const MAX_HISTORY_BYTES: usize = 32 * 1024;

#[derive(Clone)]
struct Endpoint(Url);

impl Endpoint {
    fn parse(raw: &str) -> Result<Self, ProviderError> {
        if raw.is_empty() || raw.len() > 2 * 1024 {
            return Err(ProviderError::InvalidBaseUrl);
        }
        let mut url = Url::parse(raw).map_err(|_| ProviderError::InvalidBaseUrl)?;
        if !url.username().is_empty() || url.password().is_some() {
            return Err(ProviderError::BaseUrlUserInfo);
        }
        if url.query().is_some() || url.fragment().is_some() {
            return Err(ProviderError::BaseUrlQuery);
        }
        match url.scheme() {
            "https" => {}
            "http" if is_loopback(&url) => {}
            _ => return Err(ProviderError::UnsupportedScheme),
        }
        let path = url.path().trim_end_matches('/').to_owned();
        if !matches!(path.as_str(), "" | "/v1") {
            return Err(ProviderError::BaseUrlPath);
        }
        url.set_path(&path);
        Ok(Self(url))
    }

    fn api(&self, suffix: &str) -> Url {
        let mut url = self.0.clone();
        let prefix = url.path().trim_end_matches('/');
        url.set_path(&format!("{prefix}{suffix}"));
        url
    }
}

fn is_loopback(url: &Url) -> bool {
    match url.host_str() {
        Some(host) => host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()),
        None => false,
    }
}

fn client() -> Result<Client, ProviderError> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_| ProviderError::Network)
}

fn validate(model: &str, api_key: &str) -> Result<(), ProviderError> {
    if model.trim().is_empty() || model.len() > 256 || model.chars().any(char::is_control) {
        return Err(ProviderError::InvalidModel);
    }
    if api_key.trim().is_empty() || api_key.len() > 16 * 1024 {
        return Err(ProviderError::CredentialRequired);
    }
    Ok(())
}

async fn execute(
    request: reqwest::RequestBuilder,
    cancel: &CancellationToken,
) -> Result<Response, ProviderError> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(ProviderError::Cancelled),
        response = request.send() => response.map_err(|error| {
            if error.is_timeout() { ProviderError::Timeout } else { ProviderError::Network }
        }),
    }
}

fn status(response: &Response) -> Result<(), ProviderError> {
    if response.status().is_success() {
        Ok(())
    } else if matches!(response.status().as_u16(), 401 | 403) {
        Err(ProviderError::CredentialRejected)
    } else {
        Err(ProviderError::HttpStatus(response.status().as_u16()))
    }
}

pub async fn health(
    base_url: &str,
    api_key: &str,
    cancel: CancellationToken,
) -> Result<(), ProviderError> {
    let endpoint = Endpoint::parse(base_url)?;
    validate("health-probe", api_key)?;
    let client = client()?;
    let response = execute(
        client
            .get(endpoint.api("/models"))
            .bearer_auth(api_key)
            .header("Accept", "application/json"),
        &cancel,
    )
    .await?;
    status(&response)
}

#[derive(Serialize)]
struct CompletionRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<Value>,
}

pub async fn generate<F>(
    base_url: &str,
    model: &str,
    api_key: Zeroizing<String>,
    history: Vec<ChatMessage>,
    cancel: CancellationToken,
    mut callback: F,
) -> Result<(), ProviderError>
where
    F: FnMut(Chunk) -> Result<(), ProviderError> + Send,
{
    let endpoint = Endpoint::parse(base_url)?;
    validate(model, &api_key)?;
    if history.len() > 128
        || history
            .iter()
            .map(|message| message.content.len())
            .sum::<usize>()
            > MAX_HISTORY_BYTES
        || history
            .iter()
            .any(|message| !matches!(message.role.as_str(), "user" | "assistant" | "system"))
    {
        return Err(ProviderError::HistoryTooLarge);
    }
    let mut messages = Vec::with_capacity(history.len() + 1);
    messages.push(ChatMessage {
        role: "system".into(),
        content: provider::SYSTEM_PROMPT.into(),
    });
    messages.extend(history);
    let client = client()?;
    let response = execute(
        client
            .post(endpoint.api("/chat/completions"))
            .bearer_auth(api_key.as_str())
            .json(&CompletionRequest {
                model,
                messages: &messages,
                stream: true,
                response_format: None,
            }),
        &cancel,
    )
    .await?;
    status(&response)?;
    let mut stream = response.bytes_stream();
    let mut pending = Vec::new();
    let mut total = 0usize;
    let mut done = false;
    let mut emitted = false;
    while let Some(chunk) = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
        item = stream.next() => item,
    } {
        let chunk = chunk.map_err(|_| ProviderError::Network)?;
        total = total
            .checked_add(chunk.len())
            .ok_or(ProviderError::ResponseTooLarge)?;
        if total > MAX_BODY_BYTES {
            return Err(ProviderError::ResponseTooLarge);
        }
        pending.extend_from_slice(&chunk);
        while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=end).collect();
            if line.len() > MAX_FRAME_BYTES {
                return Err(ProviderError::FrameTooLarge);
            }
            let line = std::str::from_utf8(&line).map_err(|_| ProviderError::InvalidUtf8)?;
            let Some(data) = line.trim().strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                done = true;
                break;
            }
            let value: Value =
                serde_json::from_str(data).map_err(|_| ProviderError::MalformedResponse)?;
            if let Some(error) = value.get("error") {
                if !error.is_null() {
                    return Err(ProviderError::ProviderReportedError);
                }
            }
            if let Some(content) = value
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
            {
                if !content.is_empty() {
                    callback(Ok(content.to_owned()))?;
                    emitted = true;
                }
            }
        }
        if done {
            break;
        }
        if pending.len() > MAX_FRAME_BYTES {
            return Err(ProviderError::FrameTooLarge);
        }
    }
    if !done {
        return Err(ProviderError::TruncatedStream);
    }
    if !emitted {
        return Err(ProviderError::EmptyResponse);
    }
    Ok(())
}

pub async fn extract_notes(
    base_url: &str,
    model: &str,
    api_key: Zeroizing<String>,
    source: &str,
    cancel: CancellationToken,
) -> Result<NotePatch, ProviderError> {
    let endpoint = Endpoint::parse(base_url)?;
    validate(model, &api_key)?;
    if source.len() > 6_000 {
        return Err(ProviderError::InputTooLarge);
    }
    let messages = [
        ChatMessage {
            role: "system".into(),
            content: provider::EXTRACTION_SYSTEM_PROMPT.into(),
        },
        ChatMessage {
            role: "user".into(),
            content: source.into(),
        },
    ];
    let response_format = json!({
        "type":"json_schema",
        "json_schema": {"name":"openmind_notes","strict":true,"schema":provider::extraction_schema()}
    });
    let client = client()?;
    let response = execute(
        client
            .post(endpoint.api("/chat/completions"))
            .bearer_auth(api_key.as_str())
            .json(&CompletionRequest {
                model,
                messages: &messages,
                stream: false,
                response_format: Some(response_format),
            }),
        &cancel,
    )
    .await?;
    status(&response)?;
    let bytes = response.bytes().await.map_err(|_| ProviderError::Network)?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err(ProviderError::ResponseTooLarge);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| ProviderError::MalformedResponse)?;
    let content = value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or(ProviderError::MalformedResponse)?;
    let patch: NotePatch =
        serde_json::from_str(content).map_err(|_| ProviderError::MalformedResponse)?;
    patch
        .validate_against_source(source)
        .map_err(|_| ProviderError::MalformedResponse)?;
    Ok(patch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    async fn mock_response(
        body: &'static str,
        content_type: &'static str,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0u8; 32 * 1024];
            let count = socket.read(&mut request).await.unwrap();
            request.truncate(count);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
            String::from_utf8(request).unwrap()
        });
        (format!("http://{address}/v1"), task)
    }

    #[test]
    fn remote_endpoints_require_tls_but_loopback_can_be_http() {
        assert!(Endpoint::parse("https://api.example.test/v1").is_ok());
        assert!(Endpoint::parse("http://127.0.0.1:8080/v1").is_ok());
        assert_eq!(
            Endpoint::parse("http://api.example.test/v1").err(),
            Some(ProviderError::UnsupportedScheme)
        );
        assert!(Endpoint::parse("https://user:secret@example.test/v1").is_err());
        assert!(Endpoint::parse("https://example.test/unexpected").is_err());
    }

    #[tokio::test]
    async fn compatible_stream_is_forwarded_and_authenticated() {
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Synthetic \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"reply.\"}}]}\n\ndata: [DONE]\n\n";
        let (url, request) = mock_response(body, "text/event-stream").await;
        let visible = Arc::new(Mutex::new(String::new()));
        let output = Arc::clone(&visible);
        generate(
            &url,
            "synthetic-model",
            Zeroizing::new("synthetic-key".into()),
            vec![ChatMessage {
                role: "user".into(),
                content: "Synthetic prompt".into(),
            }],
            CancellationToken::new(),
            move |chunk| {
                output.lock().unwrap().push_str(&chunk?);
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(&*visible.lock().unwrap(), "Synthetic reply.");
        let request = request.await.unwrap();
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer synthetic-key"));
    }

    #[tokio::test]
    async fn compatible_notes_request_uses_strict_schema() {
        let body = Box::leak(
            json!({"choices":[{"message":{"content":r#"{"memories":[],"notes":[]}"#}}]})
                .to_string()
                .into_boxed_str(),
        );
        let (url, request) = mock_response(body, "application/json").await;
        let patch = extract_notes(
            &url,
            "synthetic-model",
            Zeroizing::new("synthetic-key".into()),
            "I want to take a short walk.",
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert!(patch.memories.is_empty() && patch.notes.is_empty());
        let request = request.await.unwrap();
        assert!(request.contains("\\\"strict\\\":true") || request.contains("\"strict\":true"));
        assert!(request.contains("json_schema"));
    }
}
