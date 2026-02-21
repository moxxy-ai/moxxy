use serde_json::Value;

use super::{CliInterface, DisplayMessage, MessageRole};

impl CliInterface {
    pub(super) async fn load_history(&mut self) {
        self.messages.clear();
        self.session_last_id = 0;
        let url = format!(
            "{}/agents/{}/session/messages?after=0&limit=300",
            self.api_base, self.active_agent
        );
        if let Ok(res) = self.client.get(&url).send().await
            && let Ok(json) = res.json::<Value>().await
                && json.get("success").and_then(|v| v.as_bool()) == Some(true)
                    && let Some(entries) = json.get("messages").and_then(|m| m.as_array()) {
                        for entry in entries {
                            if let Some(id) = entry.get("id").and_then(|v| v.as_i64()) {
                                self.session_last_id = self.session_last_id.max(id);
                            }
                            let role = entry
                                .get("role")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default();
                            let content = entry
                                .get("content")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            match role {
                                "user" => self.messages.push(DisplayMessage {
                                    role: MessageRole::User,
                                    content,
                                }),
                                "assistant" => self.messages.push(DisplayMessage {
                                    role: MessageRole::Agent,
                                    content,
                                }),
                                _ => {}
                            }
                        }
                    }
    }

    pub(super) async fn fetch_session_updates(&mut self) {
        let url = format!(
            "{}/agents/{}/session/messages?after={}&limit=200",
            self.api_base, self.active_agent, self.session_last_id
        );

        if let Ok(res) = self.client.get(&url).send().await
            && let Ok(json) = res.json::<Value>().await {
                if json.get("success").and_then(|v| v.as_bool()) != Some(true) {
                    return;
                }
                if let Some(entries) = json.get("messages").and_then(|m| m.as_array()) {
                    let mut appended = false;
                    for entry in entries {
                        if let Some(id) = entry.get("id").and_then(|v| v.as_i64()) {
                            self.session_last_id = self.session_last_id.max(id);
                        }
                        let role = entry
                            .get("role")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default();
                        let content = entry
                            .get("content")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string();
                        match role {
                            "user" => {
                                self.messages.push(DisplayMessage {
                                    role: MessageRole::User,
                                    content,
                                });
                                appended = true;
                            }
                            "assistant" => {
                                self.messages.push(DisplayMessage {
                                    role: MessageRole::Agent,
                                    content,
                                });
                                appended = true;
                            }
                            _ => {}
                        }
                    }
                    if appended {
                        self.scroll_to_bottom();
                    }
                }
            }
    }
}
