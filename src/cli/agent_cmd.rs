use anyhow::Result;
use console::style;

use crate::core::terminal::{print_error, print_success};

pub async fn run_agent_command(args: &[String]) -> Result<()> {
    let sub_cmd = if args.len() > 2 { args[2].as_str() } else { "" };
    let mut agent_name = "default".to_string();
    let mut api_url = "http://127.0.0.1:17890".to_string();
    let mut i = 3;
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
            _ => {
                // First positional arg after subcommand is agent name
                if i == 3 {
                    agent_name = args[i].clone();
                }
                i += 1;
            }
        }
    }
    match sub_cmd {
        "restart" => {
            let url = format!("{}/api/agents/{}/restart", api_url, agent_name);
            let client = reqwest::Client::new();
            match client.post(&url).send().await {
                Ok(resp) => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            print_success(&format!("Agent '{}' restarted successfully.", agent_name));
                        } else {
                            let err = body.get("error").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                            print_error(&format!("Error: {}", err));
                        }
                    }
                }
                Err(e) => print_error(&format!("Error: Could not reach gateway — {}. Is the gateway running?", e)),
            }
        }
        "remove" | "delete" => {
            let url = format!("{}/api/agents/{}", api_url, agent_name);
            let client = reqwest::Client::new();
            match client.delete(&url).send().await {
                Ok(resp) => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            print_success(&format!("Agent '{}' removed successfully.", agent_name));
                        } else {
                            let err = body.get("error").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                            print_error(&format!("Error: {}", err));
                        }
                    }
                }
                Err(e) => print_error(&format!("Error: Could not reach gateway — {}. Is the gateway running?", e)),
            }
        }
        _ => {
            println!("{}", style("Usage: moxxy agent <command> [agent_name]").bold());
            println!("  • restart [name]   Restart the agent's session (clears STM)");
            println!("  • remove  [name]   Remove an agent permanently");
            println!("                     Options: --agent <name> --api-url <url>");
        }
    }
    Ok(())
}
