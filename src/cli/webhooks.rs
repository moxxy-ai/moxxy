use anyhow::Result;
use console::style;

use crate::core::terminal::{print_error, print_success};

pub async fn run_webhook_command(args: &[String]) -> Result<()> {
    let sub_cmd = if args.len() > 2 { args[2].as_str() } else { "" };
    let mut agent_name = "default".to_string();
    let mut api_url = "http://127.0.0.1:17890".to_string();

    // Parse global flags first
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
                i += 1;
            }
        }
    }

    let client = reqwest::Client::new();

    match sub_cmd {
        "list" | "ls" => {
            let url = format!("{}/api/agents/{}/webhooks", api_url, agent_name);
            match client.get(&url).send().await {
                Ok(resp) => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            let webhooks = body
                                .get("webhooks")
                                .and_then(|v| v.as_array())
                                .cloned()
                                .unwrap_or_default();
                            if webhooks.is_empty() {
                                println!(
                                    "  {} No webhooks registered for agent '{}'.",
                                    style("●").dim(),
                                    agent_name
                                );
                            } else {
                                println!(
                                    "\n  {} Webhooks for agent '{}':\n",
                                    style("●").cyan(),
                                    style(&agent_name).bold()
                                );
                                for wh in &webhooks {
                                    let name =
                                        wh.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                                    let source =
                                        wh.get("source").and_then(|v| v.as_str()).unwrap_or("?");
                                    let active =
                                        wh.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                                    let status = if active {
                                        style("ACTIVE").green().bold().to_string()
                                    } else {
                                        style("INACTIVE").dim().to_string()
                                    };
                                    let secret =
                                        wh.get("secret").and_then(|v| v.as_str()).unwrap_or("");
                                    let signed = if !secret.is_empty() {
                                        format!(" {}", style("[SIGNED]").yellow())
                                    } else {
                                        String::new()
                                    };
                                    println!(
                                        "  {} {} [{}]{}\n    URL: {}/api/webhooks/{}/{}",
                                        style("→").cyan(),
                                        style(name).white().bold(),
                                        status,
                                        signed,
                                        api_url,
                                        agent_name,
                                        source
                                    );
                                    if let Some(prompt) =
                                        wh.get("prompt_template").and_then(|v| v.as_str())
                                    {
                                        let truncated = if prompt.len() > 100 {
                                            format!("{}...", &prompt[..100])
                                        } else {
                                            prompt.to_string()
                                        };
                                        println!("    Prompt: {}\n", style(truncated).dim());
                                    }
                                }
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
        "add" | "register" => {
            // Parse positional args: webhook add <name> <source> <prompt> [--secret <s>]
            let mut name = String::new();
            let mut source = String::new();
            let mut prompt_template = String::new();
            let mut secret = String::new();
            let mut positional = 0;
            let mut i = 3;
            while i < args.len() {
                match args[i].as_str() {
                    "--agent" | "-a" | "--api-url" => {
                        i += 2;
                    }
                    "--secret" | "-s" => {
                        if i + 1 < args.len() {
                            secret = args[i + 1].clone();
                            i += 2;
                        } else {
                            i += 1;
                        }
                    }
                    _ => {
                        match positional {
                            0 => name = args[i].clone(),
                            1 => source = args[i].clone(),
                            2 => prompt_template = args[i].clone(),
                            _ => {}
                        }
                        positional += 1;
                        i += 1;
                    }
                }
            }

            if name.is_empty() || source.is_empty() || prompt_template.is_empty() {
                println!(
                    "{}",
                    style(
                        "Usage: moxxy webhook add <name> <source> <prompt_template> [--secret <s>]"
                    )
                    .bold()
                );
                println!(
                    "  Example: moxxy webhook add github-push github \"Process GitHub push events\""
                );
                return Ok(());
            }

            let url = format!("{}/api/agents/{}/webhooks", api_url, agent_name);
            let payload = serde_json::json!({
                "name": name,
                "source": source,
                "prompt_template": prompt_template,
                "secret": secret,
            });
            match client.post(&url).json(&payload).send().await {
                Ok(resp) => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            print_success(&format!("Webhook '{}' registered.", name));
                            if let Some(wh_url) = body.get("webhook_url").and_then(|v| v.as_str()) {
                                println!("  URL: {}", style(wh_url).cyan());
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
                Err(e) => print_error(&format!("Error: Could not reach gateway - {}", e)),
            }
        }
        "remove" | "rm" | "delete" => {
            let mut name = String::new();
            let mut i = 3;
            while i < args.len() {
                match args[i].as_str() {
                    "--agent" | "-a" | "--api-url" => {
                        i += 2;
                    }
                    _ => {
                        if name.is_empty() {
                            name = args[i].clone();
                        }
                        i += 1;
                    }
                }
            }

            if name.is_empty() {
                println!(
                    "{}",
                    style("Usage: moxxy webhook remove <webhook_name>").bold()
                );
                return Ok(());
            }

            let url = format!(
                "{}/api/agents/{}/webhooks/{}",
                api_url,
                agent_name,
                urlencoding::encode(&name)
            );
            match client.delete(&url).send().await {
                Ok(resp) => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            print_success(&format!("Webhook '{}' removed.", name));
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
        "enable" | "disable" => {
            let active = sub_cmd == "enable";
            let mut name = String::new();
            let mut i = 3;
            while i < args.len() {
                match args[i].as_str() {
                    "--agent" | "-a" | "--api-url" => {
                        i += 2;
                    }
                    _ => {
                        if name.is_empty() {
                            name = args[i].clone();
                        }
                        i += 1;
                    }
                }
            }

            if name.is_empty() {
                println!(
                    "{}",
                    style(format!("Usage: moxxy webhook {} <webhook_name>", sub_cmd)).bold()
                );
                return Ok(());
            }

            let url = format!(
                "{}/api/agents/{}/webhooks/{}",
                api_url,
                agent_name,
                urlencoding::encode(&name)
            );
            let payload = serde_json::json!({ "active": active });
            match client.patch(&url).json(&payload).send().await {
                Ok(resp) => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if body.get("success").and_then(|v| v.as_bool()) == Some(true) {
                            let action = if active { "enabled" } else { "disabled" };
                            print_success(&format!("Webhook '{}' {}.", name, action));
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
                style("Usage: moxxy webhook <command> [options]").bold()
            );
            println!("  • list                                         List all webhooks");
            println!("  • add <name> <source> <prompt> [--secret <s>]  Register a webhook");
            println!("  • remove <name>                                Remove a webhook");
            println!("  • enable <name>                                Enable a webhook");
            println!("  • disable <name>                               Disable a webhook");
            println!(
                "                     Options: --agent <name> (default: default) --api-url <url>"
            );
        }
    }

    Ok(())
}
