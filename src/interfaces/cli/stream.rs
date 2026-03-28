use serde_json::Value;
use tokio::sync::mpsc;

use super::{CliInterface, StreamEvent};

fn parse_sse_json_event(data: &str) -> Option<StreamEvent> {
    let json = serde_json::from_str::<Value>(data).ok()?;
    let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match event_type {
        "skill_invoke" => {
            let skill = json.get("skill").and_then(|v| v.as_str()).unwrap_or("?");
            let args = json.get("args").map(|v| v.to_string()).unwrap_or_default();
            Some(StreamEvent::Activity(format!(
                "Invoking skill: {} {}",
                skill, args
            )))
        }
        "skill_result" => {
            let skill = json.get("skill").and_then(|v| v.as_str()).unwrap_or("?");
            let success = json
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let output = json.get("output").and_then(|v| v.as_str()).unwrap_or("");
            let icon = if success { "✓" } else { "✗" };
            Some(StreamEvent::Activity(format!(
                "{} Skill [{}] result: {}",
                icon,
                skill,
                if output.len() > 200 {
                    format!("{}...", &output[..200])
                } else {
                    output.to_string()
                }
            )))
        }
        "thinking" => {
            let text = json.get("text").and_then(|v| v.as_str()).unwrap_or("");
            Some(StreamEvent::Activity(format!("Thinking: {}", text)))
        }
        "response" => Some(StreamEvent::Response(
            json.get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        )),
        "error" => Some(StreamEvent::Error(
            json.get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error")
                .to_string(),
        )),
        "done" => Some(StreamEvent::Done),
        _ => None,
    }
}

fn parse_non_sse_response(body: &str) -> Option<StreamEvent> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }

    let json = serde_json::from_str::<Value>(trimmed).ok()?;

    if let Some(error) = json.get("error").and_then(|v| v.as_str()) {
        return Some(StreamEvent::Error(error.to_string()));
    }

    if json.get("success").and_then(|v| v.as_bool()) == Some(false) {
        return Some(StreamEvent::Error(
            json.get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Request failed")
                .to_string(),
        ));
    }

    None
}

impl CliInterface {
    pub(super) async fn submit_chat(&mut self, prompt: String) {
        // Clear previous activity
        self.cmd_output_lines.clear();
        self.cmd_output_visible = false;

        let agent = self.active_agent.clone();
        let api_base = self.api_base.clone();
        let client = self.client.clone();

        let (tx, rx) = mpsc::channel(32);
        self.brain_rx = Some(rx);
        self.is_thinking = true;
        self.thinking_tick = 0;
        self.thinking_text = "Thinking...".to_string();

        tokio::spawn(async move {
            let url = format!("{}/agents/{}/chat/stream", api_base, agent);
            let payload = serde_json::json!({ "prompt": prompt });

            match client.post(&url).json(&payload).send().await {
                Ok(res) => {
                    let status = res.status();

                    if !status.is_success() {
                        let body = res.text().await.unwrap_or_default();
                        let event = parse_non_sse_response(&body).unwrap_or_else(|| {
                            StreamEvent::Error(format!(
                                "Request failed with status {}{}",
                                status,
                                if body.trim().is_empty() {
                                    String::new()
                                } else {
                                    format!(": {}", body.trim())
                                }
                            ))
                        });
                        let _ = tx.send(event).await;
                        let _ = tx.send(StreamEvent::Done).await;
                        return;
                    }

                    // Read the SSE stream line-by-line
                    use tokio::io::AsyncBufReadExt;
                    use tokio_stream::StreamExt;
                    let stream = res.bytes_stream();
                    let mut reader = tokio_util::io::StreamReader::new(
                        stream.map(|r| r.map_err(std::io::Error::other)),
                    );
                    let mut buf_reader = tokio::io::BufReader::new(&mut reader);
                    let mut line_buf = String::new();
                    let mut saw_done = false;
                    let mut saw_sse_data = false;
                    let mut raw_body_lines: Vec<String> = Vec::new();

                    loop {
                        line_buf.clear();
                        match buf_reader.read_line(&mut line_buf).await {
                            Ok(0) => break, // EOF
                            Ok(_) => {
                                let line = line_buf.trim();
                                if line.is_empty() {
                                    continue;
                                }
                                raw_body_lines.push(line.to_string());
                                // SSE lines: "data: {...}"
                                if let Some(data) = line.strip_prefix("data:") {
                                    let data = data.trim();
                                    saw_sse_data = true;
                                    if let Some(event) = parse_sse_json_event(data) {
                                        if event == StreamEvent::Done {
                                            saw_done = true;
                                            let _ = tx.send(StreamEvent::Done).await;
                                            break;
                                        }
                                        let _ = tx.send(event).await;
                                    }
                                }
                            }
                            Err(_) => break,
                        }
                    }

                    if !saw_done {
                        if !saw_sse_data {
                            let raw_body = raw_body_lines.join("\n");
                            if let Some(event) = parse_non_sse_response(&raw_body) {
                                let _ = tx.send(event).await;
                            }
                        }
                        let _ = tx.send(StreamEvent::Done).await;
                    }
                }
                Err(e) => {
                    let _ = tx
                        .send(StreamEvent::Error(format!("Request failed: {}", e)))
                        .await;
                    let _ = tx.send(StreamEvent::Done).await;
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sse_json_event_maps_error_payload() {
        let event = parse_sse_json_event(r#"{"type":"error","message":"Ollama unavailable"}"#);
        assert_eq!(
            event,
            Some(StreamEvent::Error("Ollama unavailable".to_string()))
        );
    }

    #[test]
    fn parse_sse_json_event_maps_done_payload() {
        let event = parse_sse_json_event(r#"{"type":"done"}"#);
        assert_eq!(event, Some(StreamEvent::Done));
    }

    #[test]
    fn parse_non_sse_response_extracts_json_error() {
        let event = parse_non_sse_response(r#"{"success":false,"error":"Agent not found"}"#);
        assert_eq!(
            event,
            Some(StreamEvent::Error("Agent not found".to_string()))
        );
    }

    #[test]
    fn parse_non_sse_response_ignores_non_error_json() {
        let event = parse_non_sse_response(r#"{"success":true}"#);
        assert_eq!(event, None);
    }
}
