use serde_json::Value;

use super::CliInterface;

impl CliInterface {
    pub(super) async fn handle_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.splitn(3, ' ').collect();
        let cmd = parts[0];

        match cmd {
            "/help" => {
                self.cmd_output_lines.clear();
                self.push_cmd_output("Commands:".to_string());
                self.push_cmd_output(
                    "  /agents [name]    List agents or switch to <name>".to_string(),
                );
                self.push_cmd_output("  /models           Show current LLM config".to_string());
                self.push_cmd_output("  /providers        List available LLM providers".to_string());
                self.push_cmd_output(
                    "  /token <provider> <key>  Set API token for provider".to_string(),
                );
                self.push_cmd_output("  /clear            Clear chat display".to_string());
                self.push_cmd_output("  /quit or /exit    Exit TUI".to_string());
                self.push_cmd_output("  /vault            List vault keys".to_string());
                self.push_cmd_output("  /vault set <k> <v> Set or update a vault key".to_string());
            }
            "/vault" => {
                if parts.get(1) == Some(&"set") {
                    if let (Some(_key), Some(_val)) = (parts.get(2), parts.get(3).or(parts.get(2)))
                    {
                        // Splitn(3, ' ') was used, but we might need more parts for 'set key value'
                        // Let's re-parse for vault set specifically if needed,
                        // but actually original parts[0] is /vault, so parts.get(1) is set,
                        // then we need key and value.
                        // Wait, parts: Vec<&str> = input.splitn(3, ' ').collect();
                        // So for "/vault set key value", parts is ["/vault", "set", "key value"]
                        let sub_parts: Vec<&str> = parts[2].splitn(2, ' ').collect();
                        if sub_parts.len() == 2 {
                            let key = sub_parts[0].to_string();
                            let value = sub_parts[1].to_string();
                            let url =
                                format!("{}/agents/{}/vault", self.api_base, self.active_agent);
                            let payload = serde_json::json!({ "key": key, "value": value });
                            self.cmd_output_lines.clear();
                            if let Ok(res) = self.client.post(&url).json(&payload).send().await {
                                if let Ok(json) = res.json::<Value>().await {
                                    if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
                                        self.push_cmd_output(format!(
                                            "Secret '{}' updated successfully.",
                                            key
                                        ));
                                    } else {
                                        let err = json
                                            .get("error")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("Unknown error");
                                        self.push_cmd_output(format!("Error: {}", err));
                                    }
                                }
                            } else {
                                self.push_cmd_output("API unreachable.".to_string());
                            }
                        } else {
                            self.push_cmd_output("Usage: /vault set <key> <value>".to_string());
                        }
                    } else {
                        self.push_cmd_output("Usage: /vault set <key> <value>".to_string());
                    }
                    return;
                }
                self.cmd_output_lines.clear();
                let url = format!("{}/agents/{}/vault", self.api_base, self.active_agent);
                if let Ok(res) = self.client.get(&url).send().await {
                    if let Ok(json) = res.json::<Value>().await {
                        if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            if let Some(keys) = json.get("keys").and_then(|k| k.as_array()) {
                                self.push_cmd_output(format!(
                                    "Vault Keys for '{}':",
                                    self.active_agent
                                ));
                                if keys.is_empty() {
                                    self.push_cmd_output("  (Empty)".to_string());
                                } else {
                                    for key in keys {
                                        if let Some(key_str) = key.as_str() {
                                            self.push_cmd_output(format!("  • {}", key_str));
                                        }
                                    }
                                }
                            }
                        } else {
                            let err = json
                                .get("error")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Unknown error");
                            self.push_cmd_output(format!("Error: {}", err));
                        }
                    }
                } else {
                    self.push_cmd_output("API unreachable.".to_string());
                }
            }
            "/agents" => {
                self.cmd_output_lines.clear();
                if let Some(name) = parts.get(1) {
                    // Switch to the named agent
                    let name = name.to_string();
                    let url = format!("{}/agents", self.api_base);
                    let mut exists = false;
                    if let Ok(res) = self.client.get(&url).send().await
                        && let Ok(json) = res.json::<Value>().await
                        && let Some(agents) = json.get("agents").and_then(|a| a.as_array())
                    {
                        exists = agents.iter().filter_map(|v| v.as_str()).any(|s| s == name);
                    }
                    if exists {
                        self.active_agent = name.clone();
                        self.load_history().await;
                        self.push_system(format!("Switched to agent '{}'", name));
                        self.cmd_output_visible = false;
                    } else {
                        self.push_cmd_output(format!("Agent '{}' not found.", name));
                    }
                } else {
                    // List all agents
                    let url = format!("{}/agents", self.api_base);
                    if let Ok(res) = self.client.get(&url).send().await
                        && let Ok(json) = res.json::<Value>().await
                        && let Some(agents) = json.get("agents").and_then(|a| a.as_array())
                    {
                        self.push_cmd_output("Agents (use /agents <name> to switch):".to_string());
                        let mut names: Vec<String> = agents
                            .iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect();
                        names.sort();
                        for name in names {
                            let marker = if name == self.active_agent {
                                " ◀"
                            } else {
                                ""
                            };
                            self.push_cmd_output(format!("  {}{}", name, marker));
                        }
                    }
                }
            }
            "/models" => {
                self.cmd_output_lines.clear();
                let url = format!("{}/agents/{}/llm", self.api_base, self.active_agent);
                if let Ok(res) = self.client.get(&url).send().await {
                    if let Ok(json) = res.json::<Value>().await {
                        if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            let provider = json
                                .get("provider")
                                .and_then(|v| v.as_str())
                                .unwrap_or("None");
                            let model =
                                json.get("model").and_then(|v| v.as_str()).unwrap_or("None");
                            self.push_cmd_output(format!(
                                "Active LLM for '{}': {} ({})",
                                self.active_agent, provider, model
                            ));
                        } else {
                            self.push_cmd_output("Could not retrieve LLM info.".to_string());
                        }
                    }
                } else {
                    self.push_cmd_output("API unreachable.".to_string());
                }
            }
            "/clear" => {
                self.messages.clear();
                self.scroll_offset = 0;
                self.cmd_output_visible = false;
                self.cmd_output_lines.clear();
            }
            "/quit" | "/exit" => {
                self.should_quit = true;
            }
            "/providers" => {
                self.cmd_output_lines.clear();
                let url = format!("{}/providers", self.api_base);
                if let Ok(res) = self.client.get(&url).send().await {
                    if let Ok(json) = res.json::<Value>().await {
                        if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            if let Some(providers) = json.get("providers").and_then(|p| p.as_array())
                            {
                                self.push_cmd_output("Available Providers:".to_string());
                                for p in providers {
                                    let _id = p.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                    let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                    let custom = p.get("custom").and_then(|v| v.as_bool()).unwrap_or(false);
                                    let vault_key = p.get("vault_key").and_then(|v| v.as_str()).unwrap_or("");
                                    let custom_tag = if custom { " (custom)" } else { "" };
                                    self.push_cmd_output(format!(
                                        "  {}{} – vault_key: {}",
                                        name,
                                        custom_tag,
                                        vault_key
                                    ));
                                }
                            }
                        } else {
                            self.push_cmd_output("Could not fetch providers.".to_string());
                        }
                    }
                } else {
                    self.push_cmd_output("API unreachable.".to_string());
                }
            }
            "/token" => {
                if let (Some(provider), Some(token)) = (parts.get(1), parts.get(2)) {
                    let url = format!("{}/providers", self.api_base);
                    let mut vault_key: Option<String> = None;
                    if let Ok(res) = self.client.get(&url).send().await {
                        if let Ok(json) = res.json::<Value>().await {
                            if let Some(providers) = json.get("providers").and_then(|p| p.as_array())
                            {
                                for p in providers {
                                    let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                    if id.eq_ignore_ascii_case(provider) {
                                        vault_key = p.get("vault_key").and_then(|v| v.as_str()).map(|s| s.to_string());
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if let Some(vk) = vault_key {
                        let set_url = format!("{}/agents/{}/vault", self.api_base, self.active_agent);
                        let payload = serde_json::json!({ "key": vk, "value": token });
                        self.cmd_output_lines.clear();
                        if let Ok(res) = self.client.post(&set_url).json(&payload).send().await {
                            if let Ok(json) = res.json::<Value>().await {
                                if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
                                    self.push_cmd_output(format!(
                                        "API token for '{}' saved to vault key '{}'.",
                                        provider, vk
                                    ));
                                } else {
                                    let err = json
                                        .get("error")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Unknown error");
                                    self.push_cmd_output(format!("Error: {}", err));
                                }
                            }
                        } else {
                            self.push_cmd_output("API unreachable.".to_string());
                        }
                    } else {
                        self.push_cmd_output(format!("Unknown provider: {}", provider));
                    }
                } else {
                    self.push_cmd_output("Usage: /token <provider> <api_key>".to_string());
                    self.push_cmd_output("Example: /token openai sk-...".to_string());
                }
            }
            _ => {
                self.cmd_output_lines.clear();
                self.push_cmd_output(format!("Unknown command: {}. Type /help for a list.", cmd));
            }
        }
    }
}
