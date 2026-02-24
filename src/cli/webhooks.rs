use anyhow::Result;
use console::style;

use crate::core::terminal::{GuideSection, print_error, print_success};

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
                                GuideSection::new(&format!("Webhooks · {}", agent_name))
                                    .text("No webhooks registered for this agent.")
                                    .print();
                            } else {
                                let mut section =
                                    GuideSection::new(&format!("Webhooks · {}", agent_name));
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
                                    section = section.bullet(&format!(
                                        "{} [{}]{}",
                                        style(name).white().bold(),
                                        status,
                                        signed,
                                    ));
                                    section = section.text(&format!(
                                        "  URL: {}/api/webhooks/{}/{}",
                                        api_url, agent_name, source
                                    ));
                                    if let Some(prompt) =
                                        wh.get("prompt_template").and_then(|v| v.as_str())
                                    {
                                        let truncated = if prompt.len() > 80 {
                                            format!("{}...", &prompt[..80])
                                        } else {
                                            prompt.to_string()
                                        };
                                        section = section.text(&format!("  Prompt: {}", truncated));
                                    }
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
                GuideSection::new("moxxy webhook add")
                    .text(
                        "Usage: moxxy webhook add <name> <source> <prompt_template> [--secret <s>]",
                    )
                    .blank()
                    .hint(
                        "moxxy webhook add github-push github \"Process GitHub push events\"",
                        "",
                    )
                    .print();
                println!();
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
                                GuideSection::new("Webhook Created")
                                    .status("URL", &style(wh_url).cyan().to_string())
                                    .print();
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
                GuideSection::new("moxxy webhook remove")
                    .text("Usage: moxxy webhook remove <webhook_name>")
                    .print();
                println!();
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
                GuideSection::new(&format!("moxxy webhook {}", sub_cmd))
                    .text(&format!("Usage: moxxy webhook {} <webhook_name>", sub_cmd))
                    .print();
                println!();
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
            GuideSection::new("moxxy webhook")
                .command("list", "List all webhooks")
                .command("add", "Register a webhook  <name> <source> <prompt>")
                .command("remove", "Remove a webhook    <name>")
                .command("enable", "Enable a webhook    <name>")
                .command("disable", "Disable a webhook   <name>")
                .blank()
                .text("Options: --agent <name>  --api-url <url>")
                .print();
            println!();
        }
    }

    Ok(())
}
