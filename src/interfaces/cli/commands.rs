use std::collections::BTreeMap;

use serde_json::Value;

use super::{CliInterface, ModelOption, ModelPickerEntry, ModelPickerMode, ModelProvider};

#[derive(Debug, PartialEq, Eq)]
enum ModelsCommand<'a> {
    OpenPicker,
    Set { provider: &'a str, model: &'a str },
    InvalidUsage,
}

fn parse_models_command(input: &str) -> ModelsCommand<'_> {
    let trimmed = input.trim();

    if trimmed == "/models" {
        return ModelsCommand::OpenPicker;
    }

    if let Some(rest) = trimmed.strip_prefix("/models ") {
        let rest = rest.trim();
        if rest.is_empty() {
            return ModelsCommand::OpenPicker;
        }

        let mut parts = rest.splitn(2, ' ');
        let provider = parts.next().unwrap_or_default().trim();
        let model = parts.next().unwrap_or_default().trim();

        if provider.is_empty() || model.is_empty() {
            return ModelsCommand::InvalidUsage;
        }

        return ModelsCommand::Set { provider, model };
    }

    if let Some(rest) = trimmed.strip_prefix("/setmodel ") {
        let rest = rest.trim();
        let mut parts = rest.splitn(2, ' ');
        let provider = parts.next().unwrap_or_default().trim();
        let model = parts.next().unwrap_or_default().trim();

        if provider.is_empty() || model.is_empty() {
            return ModelsCommand::InvalidUsage;
        }

        return ModelsCommand::Set { provider, model };
    }

    if trimmed == "/setmodel" {
        return ModelsCommand::InvalidUsage;
    }

    ModelsCommand::InvalidUsage
}

async fn set_model_for_active_agent(cli: &mut CliInterface, provider: &str, model: &str) {
    let url = format!("{}/agents/{}/llm", cli.api_base, cli.active_agent);
    let payload = serde_json::json!({ "provider": provider, "model": model });
    cli.cmd_output_lines.clear();

    if let Ok(res) = cli.client.post(&url).json(&payload).send().await {
        if let Ok(json) = res.json::<Value>().await {
            if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
                cli.push_cmd_output(format!(
                    "LLM set to {} / {}. Restarting gateway...",
                    provider, model
                ));
                let restart_url = format!("{}/gateway/restart", cli.api_base);
                let _ = cli.client.post(&restart_url).send().await;
                cli.push_cmd_output("Gateway restart triggered.".to_string());
            } else {
                let err = json
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                cli.push_cmd_output(format!("Error: {}", err));
            }
        }
    } else {
        cli.push_cmd_output("API unreachable.".to_string());
    }
}

fn matches_model_query(model: &ModelOption, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }

    model.provider_name.to_lowercase().contains(&query)
        || model.provider_id.to_lowercase().contains(&query)
        || model.model_name.to_lowercase().contains(&query)
        || model.model_id.to_lowercase().contains(&query)
        || model
            .deployment
            .as_ref()
            .map(|deployment| deployment.to_lowercase().contains(&query))
            .unwrap_or(false)
}

fn matches_custom_query(provider: &ModelProvider, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }

    provider.provider_name.to_lowercase().contains(&query)
        || provider.provider_id.to_lowercase().contains(&query)
        || "custom model".contains(&query)
}

pub(super) fn build_model_picker_entries(
    providers: &[ModelProvider],
    models: &[ModelOption],
    query: &str,
    current_custom: Option<(&str, &str)>,
) -> Vec<ModelPickerEntry> {
    let mut by_provider: BTreeMap<(String, String), Vec<ModelOption>> = BTreeMap::new();
    for provider in providers {
        by_provider
            .entry((provider.provider_name.clone(), provider.provider_id.clone()))
            .or_default();
    }
    for model in models.iter().cloned() {
        by_provider
            .entry((model.provider_name.clone(), model.provider_id.clone()))
            .or_default()
            .push(model);
    }

    let mut entries = Vec::new();
    for ((provider_name, provider_id), mut provider_models) in by_provider {
        let provider = ModelProvider {
            provider_id: provider_id.clone(),
            provider_name: provider_name.clone(),
        };

        provider_models.sort_by(|left, right| {
            let left_rank = if left.deployment.as_deref() == Some("local") {
                0
            } else if left.deployment.as_deref() == Some("cloud") {
                1
            } else {
                2
            };
            let right_rank = if right.deployment.as_deref() == Some("local") {
                0
            } else if right.deployment.as_deref() == Some("cloud") {
                1
            } else {
                2
            };
            left_rank.cmp(&right_rank).then_with(|| {
                left.model_name
                    .to_lowercase()
                    .cmp(&right.model_name.to_lowercase())
            })
        });

        let visible_models = provider_models
            .iter()
            .filter(|model| matches_model_query(model, query))
            .cloned()
            .collect::<Vec<_>>();
        let provider_matches = matches_custom_query(&provider, query);

        if visible_models.is_empty() && !provider_matches {
            continue;
        }

        let current_custom_for_provider = current_custom
            .filter(|(provider_key, _)| *provider_key == provider.provider_id)
            .map(|(_, model_id)| model_id.to_string());

        entries.push(ModelPickerEntry::Section(provider.provider_name.clone()));
        for model in visible_models {
            entries.push(ModelPickerEntry::Model(model));
        }
        entries.push(ModelPickerEntry::Custom {
            provider_id: provider.provider_id,
            provider_name: provider.provider_name,
            is_current: current_custom_for_provider.is_some(),
            current_model_id: current_custom_for_provider,
        });
    }

    entries
}

async fn open_model_picker(cli: &mut CliInterface) {
    let providers_url = format!("{}/providers", cli.api_base);
    let llm_url = format!("{}/agents/{}/llm", cli.api_base, cli.active_agent);

    let providers_res = cli.client.get(&providers_url).send().await;
    let llm_res = cli.client.get(&llm_url).send().await;

    let mut current_provider = String::new();
    let mut current_model = String::new();

    if let Ok(res) = llm_res
        && let Ok(json) = res.json::<Value>().await
        && json.get("success").and_then(|v| v.as_bool()) == Some(true)
    {
        current_provider = json
            .get("provider")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        current_model = json
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
    }

    let mut providers = Vec::new();
    let mut models = Vec::new();
    if let Ok(res) = providers_res
        && let Ok(json) = res.json::<Value>().await
        && json.get("success").and_then(|v| v.as_bool()) == Some(true)
        && let Some(provider_values) = json.get("providers").and_then(|v| v.as_array())
    {
        for provider in provider_values {
            let provider_id = provider
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let provider_name = provider
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if provider_id.is_empty() {
                continue;
            }

            providers.push(ModelProvider {
                provider_id: provider_id.clone(),
                provider_name: provider_name.clone(),
            });

            let supports_live_models = provider
                .get("supports_live_models")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let mut live_models_override: Option<Vec<Value>> = None;
            if supports_live_models {
                let live_url = format!(
                    "{}/providers/{}/models/live",
                    cli.api_base,
                    urlencoding::encode(&provider_id)
                );
                if let Ok(live_res) = cli.client.get(&live_url).send().await
                    && let Ok(live_json) = live_res.json::<Value>().await
                    && live_json.get("success").and_then(|v| v.as_bool()) == Some(true)
                {
                    live_models_override =
                        live_json.get("models").and_then(|v| v.as_array()).cloned();
                }
            }

            if let Some(provider_models) = live_models_override
                .as_ref()
                .or_else(|| provider.get("models").and_then(|v| v.as_array()))
            {
                for model in provider_models {
                    let model_id = model
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    if model_id.is_empty() {
                        continue;
                    }

                    let model_name = model
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&model_id)
                        .to_string();
                    let deployment = model
                        .get("deployment")
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string());

                    models.push(ModelOption {
                        provider_id: provider_id.clone(),
                        provider_name: provider_name.clone(),
                        model_id: model_id.clone(),
                        model_name,
                        deployment,
                        is_current: provider_id == current_provider && model_id == current_model,
                    });
                }
            }
        }
    }

    let current_custom = if !current_provider.is_empty()
        && !current_model.is_empty()
        && !models
            .iter()
            .any(|model| model.provider_id == current_provider && model.model_id == current_model)
    {
        Some((current_provider.as_str(), current_model.as_str()))
    } else {
        None
    };

    cli.model_picker_query.clear();
    cli.model_picker_focus = super::ModelPickerFocus::List;
    cli.model_picker_mode = ModelPickerMode::Browse;
    cli.model_picker_custom_input.clear();
    cli.model_picker_providers = providers;
    cli.model_picker_models = models;
    cli.model_picker_entries = build_model_picker_entries(
        &cli.model_picker_providers,
        &cli.model_picker_models,
        "",
        current_custom,
    );
    cli.model_picker_selected = cli
        .model_picker_entries
        .iter()
        .position(|entry| match entry {
            ModelPickerEntry::Model(model) => model.is_current,
            ModelPickerEntry::Custom { is_current, .. } => *is_current,
            ModelPickerEntry::Section(_) => false,
        })
        .or_else(|| {
            cli.model_picker_entries.iter().position(|entry| {
                matches!(
                    entry,
                    ModelPickerEntry::Model(_) | ModelPickerEntry::Custom { .. }
                )
            })
        })
        .unwrap_or(0);
    cli.model_picker_status = if cli.model_picker_entries.is_empty() {
        Some("No models available.".to_string())
    } else {
        None
    };
    cli.model_picker_visible = true;
}

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
                self.push_cmd_output(
                    "  /models           Open interactive model picker".to_string(),
                );
                self.push_cmd_output(
                    "  /models <provider> <model>  Set provider and model directly".to_string(),
                );
                self.push_cmd_output(
                    "  /setmodel <provider> <model>  Alias for /models <provider> <model>"
                        .to_string(),
                );
                self.push_cmd_output(
                    "  /providers        List available LLM providers".to_string(),
                );
                self.push_cmd_output(
                    "  /token <provider> <key>  Set API token for provider".to_string(),
                );
                self.push_cmd_output("  /clear            Clear chat display".to_string());
                self.push_cmd_output("  /quit or /exit    Exit the TUI".to_string());
                self.push_cmd_output("  /vault            List vault keys".to_string());
                self.push_cmd_output("  /vault set <k> <v> Set or update a vault key".to_string());
            }
            "/vault" => {
                if parts.get(1) == Some(&"set") {
                    if let (Some(_key), Some(_val)) = (parts.get(2), parts.get(3).or(parts.get(2)))
                    {
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
                                            "Secret '{}' updated successfully (changes applied immediately).",
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
                                            self.push_cmd_output(format!("  - {}", key_str));
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
            "/models" => match parse_models_command(input) {
                ModelsCommand::OpenPicker => {
                    open_model_picker(self).await;
                }
                ModelsCommand::Set { provider, model } => {
                    set_model_for_active_agent(self, provider, model).await;
                }
                ModelsCommand::InvalidUsage => {
                    self.cmd_output_lines.clear();
                    self.push_cmd_output("Usage: /models".to_string());
                    self.push_cmd_output("   or: /models <provider> <model>".to_string());
                    self.push_cmd_output("Example: /models ollama gpt-oss:20b".to_string());
                }
            },
            "/setmodel" => match parse_models_command(input) {
                ModelsCommand::Set { provider, model } => {
                    set_model_for_active_agent(self, provider, model).await;
                }
                _ => {
                    self.cmd_output_lines.clear();
                    self.push_cmd_output("Usage: /setmodel <provider> <model>".to_string());
                    self.push_cmd_output("Example: /setmodel ollama gpt-oss:20b".to_string());
                }
            },
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
                            if let Some(providers) =
                                json.get("providers").and_then(|p| p.as_array())
                            {
                                self.push_cmd_output("Available Providers:".to_string());
                                for p in providers {
                                    let _id = p.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                    let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                    let custom =
                                        p.get("custom").and_then(|v| v.as_bool()).unwrap_or(false);
                                    let vault_key =
                                        p.get("vault_key").and_then(|v| v.as_str()).unwrap_or("");
                                    let custom_tag = if custom { " (custom)" } else { "" };
                                    self.push_cmd_output(format!(
                                        "  {}{} - vault_key: {}",
                                        name, custom_tag, vault_key
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
                            if let Some(providers) =
                                json.get("providers").and_then(|p| p.as_array())
                            {
                                for p in providers {
                                    let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                    if id.eq_ignore_ascii_case(provider) {
                                        vault_key = p
                                            .get("vault_key")
                                            .and_then(|v| v.as_str())
                                            .map(|s| s.to_string());
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    if let Some(vk) = vault_key {
                        let set_url =
                            format!("{}/agents/{}/vault", self.api_base, self.active_agent);
                        let payload = serde_json::json!({ "key": vk, "value": token });
                        self.cmd_output_lines.clear();
                        if let Ok(res) = self.client.post(&set_url).json(&payload).send().await {
                            if let Ok(json) = res.json::<Value>().await {
                                if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
                                    self.push_cmd_output(format!(
                                        "API token for '{}' saved and hot-reloaded (vault key '{}').",
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

#[cfg(test)]
mod tests {
    use super::{
        ModelOption, ModelPickerEntry, ModelProvider, ModelsCommand, build_model_picker_entries,
        parse_models_command,
    };

    #[test]
    fn parse_models_command_shows_current_when_no_args() {
        assert_eq!(parse_models_command("/models"), ModelsCommand::OpenPicker);
        assert_eq!(
            parse_models_command("/models   "),
            ModelsCommand::OpenPicker
        );
    }

    #[test]
    fn parse_models_command_sets_provider_and_model() {
        assert_eq!(
            parse_models_command("/models ollama gpt-oss:20b"),
            ModelsCommand::Set {
                provider: "ollama",
                model: "gpt-oss:20b",
            }
        );
    }

    #[test]
    fn parse_models_command_accepts_setmodel_alias() {
        assert_eq!(
            parse_models_command("/setmodel openai gpt-4o"),
            ModelsCommand::Set {
                provider: "openai",
                model: "gpt-4o",
            }
        );
    }

    #[test]
    fn parse_models_command_rejects_incomplete_usage() {
        assert_eq!(
            parse_models_command("/models ollama"),
            ModelsCommand::InvalidUsage
        );
        assert_eq!(
            parse_models_command("/setmodel"),
            ModelsCommand::InvalidUsage
        );
    }

    #[test]
    fn build_model_picker_entries_groups_models_and_custom_rows_by_provider() {
        let providers = vec![
            ModelProvider {
                provider_id: "openai".to_string(),
                provider_name: "OpenAI".to_string(),
            },
            ModelProvider {
                provider_id: "ollama".to_string(),
                provider_name: "Ollama".to_string(),
            },
        ];
        let models = vec![
            ModelOption {
                provider_id: "openai".to_string(),
                provider_name: "OpenAI".to_string(),
                model_id: "gpt-4o".to_string(),
                model_name: "GPT-4o".to_string(),
                deployment: None,
                is_current: false,
            },
            ModelOption {
                provider_id: "ollama".to_string(),
                provider_name: "Ollama".to_string(),
                model_id: "gpt-oss:20b".to_string(),
                model_name: "gpt-oss:20b".to_string(),
                deployment: Some("local".to_string()),
                is_current: true,
            },
        ];

        let entries = build_model_picker_entries(&providers, &models, "", None);
        assert!(matches!(&entries[0], ModelPickerEntry::Section(name) if name == "Ollama"));
        assert!(
            matches!(&entries[1], ModelPickerEntry::Model(model) if model.model_id == "gpt-oss:20b")
        );
        assert!(
            matches!(&entries[2], ModelPickerEntry::Custom { provider_name, .. } if provider_name == "Ollama")
        );
        assert!(matches!(&entries[3], ModelPickerEntry::Section(name) if name == "OpenAI"));
        assert!(
            matches!(&entries[4], ModelPickerEntry::Model(model) if model.model_id == "gpt-4o")
        );
        assert!(
            matches!(&entries[5], ModelPickerEntry::Custom { provider_name, .. } if provider_name == "OpenAI")
        );
    }

    #[test]
    fn build_model_picker_entries_filters_models_by_query() {
        let providers = vec![ModelProvider {
            provider_id: "ollama".to_string(),
            provider_name: "Ollama".to_string(),
        }];
        let models = vec![ModelOption {
            provider_id: "ollama".to_string(),
            provider_name: "Ollama".to_string(),
            model_id: "gpt-oss:20b".to_string(),
            model_name: "gpt-oss:20b".to_string(),
            deployment: Some("local".to_string()),
            is_current: false,
        }];

        let entries = build_model_picker_entries(&providers, &models, "oss", None);
        assert_eq!(entries.len(), 3);
        assert!(matches!(&entries[0], ModelPickerEntry::Section(name) if name == "Ollama"));
        assert!(
            matches!(&entries[1], ModelPickerEntry::Model(model) if model.model_id == "gpt-oss:20b")
        );
        assert!(
            matches!(&entries[2], ModelPickerEntry::Custom { provider_name, .. } if provider_name == "Ollama")
        );
    }

    #[test]
    fn build_model_picker_entries_keeps_custom_row_when_query_matches_custom() {
        let providers = vec![ModelProvider {
            provider_id: "ollama".to_string(),
            provider_name: "Ollama".to_string(),
        }];
        let models = vec![ModelOption {
            provider_id: "ollama".to_string(),
            provider_name: "Ollama".to_string(),
            model_id: "gpt-oss:20b".to_string(),
            model_name: "gpt-oss:20b".to_string(),
            deployment: Some("local".to_string()),
            is_current: false,
        }];

        let entries = build_model_picker_entries(&providers, &models, "custom", None);
        assert_eq!(entries.len(), 2);
        assert!(matches!(&entries[0], ModelPickerEntry::Section(name) if name == "Ollama"));
        assert!(
            matches!(&entries[1], ModelPickerEntry::Custom { provider_name, .. } if provider_name == "Ollama")
        );
    }
}
