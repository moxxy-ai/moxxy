use anyhow::Result;
use console::style;

use crate::core::terminal::{GuideSection, print_error, print_success};

pub async fn run_token_command(args: &[String]) -> Result<()> {
    let sub_cmd = if args.len() > 3 { args[3].as_str() } else { "" };
    let mut agent_name = "default".to_string();
    let mut api_url = "http://127.0.0.1:17890".to_string();
    let mut token_name = String::new();
    let mut token_id = String::new();

    let mut i = 4;
    while i < args.len() {
        match args[i].as_str() {
            "--agent" | "-a" => {
                if i + 1 < args.len() {
                    agent_name = args[i + 1].clone();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--api-url" => {
                if i + 1 < args.len() {
                    api_url = args[i + 1].clone();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--name" | "-n" => {
                if i + 1 < args.len() {
                    token_name = args[i + 1].clone();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--id" => {
                if i + 1 < args.len() {
                    token_id = args[i + 1].clone();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => {
                // First positional arg used as name or id depending on subcommand
                if token_name.is_empty() && token_id.is_empty() {
                    match sub_cmd {
                        "create" => token_name = args[i].clone(),
                        "revoke" | "delete" | "rm" => token_id = args[i].clone(),
                        _ => {}
                    }
                }
                i += 1;
            }
        }
    }

    let client = reqwest::Client::new();

    match sub_cmd {
        "create" => {
            if token_name.is_empty() {
                GuideSection::new("moxxy gateway token create")
                    .text("Usage: moxxy gateway token create <name> [--agent <name>]")
                    .blank()
                    .hint(
                        "moxxy gateway token create my-integration --agent default",
                        "",
                    )
                    .print();
                println!();
                return Ok(());
            }

            let url = format!("{}/api/agents/{}/tokens", api_url, agent_name);
            let payload = serde_json::json!({ "name": token_name });
            match client.post(&url).json(&payload).send().await {
                Ok(resp) => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            let token = body.get("token").and_then(|v| v.as_str()).unwrap_or("?");
                            print_success(&format!(
                                "API token '{}' created for agent '{}'.",
                                token_name, agent_name
                            ));
                            GuideSection::new("API Token Created")
                                .status("Token", &style(token).green().bold().to_string())
                                .blank()
                                .warn("Save this token now - it will not be shown again.")
                                .text(&format!("Use it with: Authorization: Bearer {}", token))
                                .print();
                            println!();
                        } else {
                            let err = body
                                .get("error")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Unknown error");
                            print_error(&format!("Error: {}", err));
                        }
                    }
                }
                Err(e) => print_error(&format!(
                    "Error: Could not reach gateway - {}. Is the gateway running?",
                    e
                )),
            }
        }
        "list" | "ls" => {
            let url = format!("{}/api/agents/{}/tokens", api_url, agent_name);
            match client.get(&url).send().await {
                Ok(resp) => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            let tokens = body
                                .get("tokens")
                                .and_then(|v| v.as_array())
                                .cloned()
                                .unwrap_or_default();
                            if tokens.is_empty() {
                                GuideSection::new(&format!("API Tokens · {}", agent_name))
                                    .text("No API tokens found for this agent.")
                                    .print();
                            } else {
                                let mut section =
                                    GuideSection::new(&format!("API Tokens · {}", agent_name));
                                for tk in &tokens {
                                    let id = tk.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                                    let name =
                                        tk.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                                    let created = tk
                                        .get("created_at")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("?");
                                    let short_id = if id.len() > 8 { &id[..8] } else { id };
                                    section = section.bullet(&format!(
                                        "{} (id: {}...)  created: {}",
                                        style(name).white().bold(),
                                        style(short_id).dim(),
                                        style(created).dim()
                                    ));
                                }
                                section.print();
                            }
                            println!();
                        } else {
                            let err = body
                                .get("error")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Unknown error");
                            print_error(&format!("Error: {}", err));
                        }
                    }
                }
                Err(e) => print_error(&format!(
                    "Error: Could not reach gateway - {}. Is the gateway running?",
                    e
                )),
            }
        }
        "revoke" | "delete" | "rm" => {
            if token_id.is_empty() {
                GuideSection::new("moxxy gateway token revoke")
                    .text("Usage: moxxy gateway token revoke <token_id> [--agent <name>]")
                    .print();
                println!();
                return Ok(());
            }

            let url = format!(
                "{}/api/agents/{}/tokens/{}",
                api_url,
                agent_name,
                urlencoding::encode(&token_id)
            );
            match client.delete(&url).send().await {
                Ok(resp) => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            print_success("Token revoked.");
                        } else {
                            let err = body
                                .get("error")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Unknown error");
                            print_error(&format!("Error: {}", err));
                        }
                    }
                }
                Err(e) => print_error(&format!("Error: Could not reach gateway - {}", e)),
            }
        }
        _ => {
            GuideSection::new("moxxy gateway token")
                .command("create", "Create a new API token  <name>")
                .command("list", "List all API tokens")
                .command("revoke", "Revoke an API token     <id>")
                .blank()
                .text("Options: --agent <name>  --api-url <url>")
                .print();
            println!();
        }
    }

    Ok(())
}
