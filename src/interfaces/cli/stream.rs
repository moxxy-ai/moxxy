use serde_json::Value;
use tokio::sync::mpsc;

use super::{CliInterface, StreamEvent};

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
                    // Read the SSE stream line-by-line
                    use tokio::io::AsyncBufReadExt;
                    use tokio_stream::StreamExt;
                    let stream = res.bytes_stream();
                    let mut reader = tokio_util::io::StreamReader::new(
                        stream.map(|r| r.map_err(std::io::Error::other)),
                    );
                    let mut buf_reader = tokio::io::BufReader::new(&mut reader);
                    let mut line_buf = String::new();

                    loop {
                        line_buf.clear();
                        match buf_reader.read_line(&mut line_buf).await {
                            Ok(0) => break, // EOF
                            Ok(_) => {
                                let line = line_buf.trim();
                                if line.is_empty() {
                                    continue;
                                }
                                // SSE lines: "data: {...}"
                                if let Some(data) = line.strip_prefix("data:") {
                                    let data = data.trim();
                                    if let Ok(json) = serde_json::from_str::<Value>(data) {
                                        let event_type =
                                            json.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                        match event_type {
                                            "skill_invoke" => {
                                                let skill = json
                                                    .get("skill")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("?");
                                                let args = json
                                                    .get("args")
                                                    .map(|v| v.to_string())
                                                    .unwrap_or_default();
                                                let _ = tx
                                                    .send(StreamEvent::Activity(format!(
                                                        "⚡ Invoking skill: {} {}",
                                                        skill, args
                                                    )))
                                                    .await;
                                            }
                                            "skill_result" => {
                                                let skill = json
                                                    .get("skill")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("?");
                                                let success = json
                                                    .get("success")
                                                    .and_then(|v| v.as_bool())
                                                    .unwrap_or(false);
                                                let output = json
                                                    .get("output")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("");
                                                let icon = if success { "✓" } else { "✗" };
                                                let _ = tx
                                                    .send(StreamEvent::Activity(format!(
                                                        "{} Skill [{}] result: {}",
                                                        icon,
                                                        skill,
                                                        if output.len() > 200 {
                                                            format!("{}...", &output[..200])
                                                        } else {
                                                            output.to_string()
                                                        }
                                                    )))
                                                    .await;
                                            }
                                            "thinking" => {
                                                let text = json
                                                    .get("text")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("");
                                                let _ = tx
                                                    .send(StreamEvent::Activity(format!(
                                                        "💭 {}",
                                                        text
                                                    )))
                                                    .await;
                                            }
                                            "response" => {
                                                let text = json
                                                    .get("text")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("");
                                                let _ = tx
                                                    .send(StreamEvent::Response(text.to_string()))
                                                    .await;
                                            }
                                            "error" => {
                                                let msg = json
                                                    .get("message")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("Unknown error");
                                                let _ = tx
                                                    .send(StreamEvent::Error(msg.to_string()))
                                                    .await;
                                            }
                                            "done" => {
                                                let _ = tx.send(StreamEvent::Done).await;
                                                break;
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                            }
                            Err(_) => break,
                        }
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
