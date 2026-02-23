use anyhow::Result;
use console::style;

use crate::core::terminal::{print_error, print_success};

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
                println!(
                    "{}",
                    style("Usage: moxxy gateway token create <name> [--agent <name>]").bold()
                );
                println!("  Example: moxxy gateway token create my-integration --agent default");
                return Ok(());
            }

            let url = format!("{}/api/agents/{}/tokens", api_url, agent_name);
            let payload = serde_json::json!({ "name": token_name });
            match client.post(&url).json(&payload).send().await {
                Ok(resp) => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            let token = body.get("token").and_then(|v| v.as_str()).unwrap_or("?");
                            println!();
                            print_success(&format!(
                                "API token '{}' created for agent '{}'.",
                                token_name, agent_name
                            ));
                            println!(
                                "\n  {} {}\n",
                                style("Token:").bold(),
                                style(token).green().bold()
                            );
                            println!(
                                "  {} Save this token now — it will not be shown again.",
                                style("⚠").yellow()
                            );
                            println!(
                                "  {} Use it with: Authorization: Bearer {}\n",
                                style("→").cyan(),
                                token
                            );
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
                                println!(
                                    "  {} No API tokens for agent '{}'.",
                                    style("●").dim(),
                                    agent_name
                                );
                            } else {
                                println!(
                                    "\n  {} API tokens for agent '{}':\n",
                                    style("●").cyan(),
                                    style(&agent_name).bold()
                                );
                                for tk in &tokens {
                                    let id = tk.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                                    let name =
                                        tk.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                                    let created = tk
                                        .get("created_at")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("?");
                                    let short_id = if id.len() > 8 { &id[..8] } else { id };
                                    println!(
                                        "  {} {} (id: {}…)  created: {}",
                                        style("→").cyan(),
                                        style(name).white().bold(),
                                        style(short_id).dim(),
                                        style(created).dim()
                                    );
                                }
                                println!();
                            }
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
                println!(
                    "{}",
                    style("Usage: moxxy gateway token revoke <token_id> [--agent <name>]").bold()
                );
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
            println!(
                "{}",
                style("Usage: moxxy gateway token <command> [options]").bold()
            );
            println!("  • create <name>    Create a new API token");
            println!("  • list             List all API tokens");
            println!("  • revoke <id>      Revoke an API token");
            println!("\n  Options: --agent <name> (default: default) --api-url <url>");
        }
    }

    Ok(())
}
