mod agent_cmd;
mod channels;
mod daemon;
mod doctor;
mod install;
mod migrate;
mod onboarding;
mod swarm;
mod uninstall;
mod update;
mod webhooks;

use anyhow::Result;
use console::style;

use crate::core::agent::RunMode;
use crate::core::terminal::{self, print_error, print_link, print_status};
use crate::interfaces::cli::CliInterface;

fn print_help() {
    terminal::print_banner();
    println!(
        "{} {}\n",
        terminal::LOOKING_GLASS,
        style("moxxy is a highly secure, next-generation Agentic Swarm framework.").dim()
    );
    println!("{}", style("Commands:").bold().underlined());
    println!("  {} web       Start the Web Dashboard", style("▶").cyan());
    println!(
        "  {} tui       Start the Interactive Terminal UI",
        style("▶").cyan()
    );
    println!(
        "  {} dev       Start the Daemon in Elevated Dev Mode",
        style("▶").cyan()
    );
    println!(
        "  {} install   Set up directories and database (non-interactive)",
        style("▶").cyan()
    );
    println!(
        "  {} init      Run the Onboarding Wizard (or 'onboard')",
        style("▶").cyan()
    );
    println!(
        "  {} migrate   Migrate from OpenClaw to Moxxy",
        style("▶").cyan()
    );
    println!(
        "  {} gateway   Manage the background daemon process",
        style("▶").cyan()
    );
    println!(
        "  {} doctor    Check system dependencies",
        style("▶").cyan()
    );
    println!(
        "  {} channel   Manage channel connections",
        style("▶").cyan()
    );
    println!("  {} agent     Manage agents", style("▶").cyan());
    println!("  {} webhook   Manage webhook endpoints", style("▶").cyan());
    println!(
        "  {} update    Update moxxy to the latest version",
        style("▶").cyan()
    );
    println!(
        "  {} uninstall Remove moxxy binary and all data",
        style("▶").cyan()
    );
    println!(
        "  {} logs      Follow real-time daemon logs",
        style("▶").cyan()
    );
    println!(
        "  {} run       Run a single programmatic prompt",
        style("▶").cyan()
    );
    println!(
        "\n{} {} <command> [subcommand]\n",
        style("Usage:").bold(),
        style("moxxy").green()
    );
}

pub async fn run_main() -> Result<()> {
    let run_mode;
    let args: Vec<String> = std::env::args().collect();
    let run_dir = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".moxxy")
        .join("run");
    let pid_file = run_dir.join("moxxy.pid");

    let mut target_agent: Option<String> = None;
    let mut api_host = "127.0.0.1".to_string();
    let mut api_port: u16 = 17890;
    let mut web_port: u16 = 3001;

    // Load global config from default agent's vault if it exists
    let home = dirs::home_dir().expect("Could not find home directory");
    let default_agent_dir = home.join(".moxxy").join("agents").join("default");
    if default_agent_dir.exists()
        && let Ok(memory_sys) = crate::core::memory::MemorySystem::new(&default_agent_dir).await
    {
        let vault = crate::core::vault::SecretsVault::new(memory_sys.get_db());
        if vault.initialize().await.is_ok() {
            if let Ok(Some(host)) = vault.get_secret("gateway_host").await {
                api_host = host;
            }
            if let Ok(Some(port_str)) = vault.get_secret("gateway_port").await
                && let Ok(port) = port_str.parse()
            {
                api_port = port;
            }
            if let Ok(Some(web_port_str)) = vault.get_secret("web_ui_port").await
                && let Ok(w_port) = web_port_str.parse()
            {
                web_port = w_port;
            }
        }
    }

    if args.len() > 1 {
        let cmd = args[1].as_str();
        match cmd {
            "run" => {
                let mut agent_val = "default".to_string();
                let mut prompt_val = String::new();
                let mut i = 2;
                while i < args.len() {
                    match args[i].as_str() {
                        "--agent" | "-a" => {
                            if i + 1 < args.len() {
                                agent_val = args[i + 1].clone();
                                i += 2;
                            } else {
                                i += 1;
                            }
                        }
                        "--prompt" | "-p" => {
                            if i + 1 < args.len() {
                                prompt_val = args[i + 1].clone();
                                i += 2;
                            } else {
                                i += 1;
                            }
                        }
                        _ => i += 1,
                    }
                }
                if prompt_val.is_empty() {
                    print_error("Error: --prompt is required for run mode.");
                    print_help();
                    return Ok(());
                }
                target_agent = Some(agent_val);
                run_mode = RunMode::Headless(prompt_val);
            }
            "gateway" => {
                let sub_cmd = if args.len() > 2 { args[2].as_str() } else { "" };
                match sub_cmd {
                    "start" => {
                        daemon::gateway_start(&run_dir, &pid_file, &api_host, api_port, &args)
                            .await?;
                        return Ok(());
                    }
                    "stop" => {
                        daemon::gateway_stop(&pid_file).await?;
                        return Ok(());
                    }
                    "restart" => {
                        daemon::gateway_restart().await?;
                        return Ok(());
                    }
                    "status" => {
                        daemon::gateway_status(&pid_file).await?;
                        return Ok(());
                    }
                    _ => {
                        print_error(
                            "Unknown or missing gateway command. Expected: start, stop, restart, status",
                        );
                        print_help();
                        return Ok(());
                    }
                }
            }
            "logs" => {
                daemon::follow_logs(&run_dir, &pid_file).await?;
                return Ok(());
            }
            "daemon-run" => {
                run_mode = RunMode::Daemon;
                let mut i = 2;
                while i < args.len() {
                    match args[i].as_str() {
                        "--api-port" => {
                            if i + 1 < args.len() {
                                api_port = args[i + 1].parse().unwrap_or(17890);
                                i += 2;
                            } else {
                                i += 1;
                            }
                        }
                        "--api-host" => {
                            if i + 1 < args.len() {
                                api_host = args[i + 1].clone();
                                i += 2;
                            } else {
                                i += 1;
                            }
                        }
                        _ => i += 1,
                    }
                }
            }
            "web" => {
                if !pid_file.exists() {
                    print_error(
                        "Error: moxxy Gateway is not running. Please run 'moxxy gateway start' first.",
                    );
                    return Ok(());
                }

                let mut i = 2;
                while i < args.len() {
                    match args[i].as_str() {
                        "--api-port" => {
                            if i + 1 < args.len() {
                                api_port = args[i + 1].parse().unwrap_or(17890);
                                i += 2;
                            } else {
                                i += 1;
                            }
                        }
                        "--api-host" => {
                            if i + 1 < args.len() {
                                api_host = args[i + 1].clone();
                                i += 2;
                            } else {
                                i += 1;
                            }
                        }
                        "--port" => {
                            if i + 1 < args.len() {
                                web_port = args[i + 1].parse().unwrap_or(3001);
                                i += 2;
                            } else {
                                i += 1;
                            }
                        }
                        _ => i += 1,
                    }
                }

                // Pure frontend server - does NOT boot any agents or API
                use crate::core::lifecycle::LifecycleComponent;
                use crate::interfaces::web::WebServer;

                let mut web = WebServer::new(RunMode::Web, api_host, api_port, web_port);
                web.on_init().await?;
                web.on_start().await?;

                println!();
                print_link(
                    "Web Dashboard serving on",
                    &format!("http://127.0.0.1:{}", web_port),
                );
                print_status("API Endpoint", &format!("http://127.0.0.1:{}", api_port));
                println!(
                    "\n  {} Press {} to stop.\n",
                    style("ℹ").blue(),
                    style("Ctrl+C").bold().yellow()
                );

                tokio::signal::ctrl_c().await?;
                web.on_shutdown().await?;
                return Ok(());
            }
            "tui" => {
                if !pid_file.exists() {
                    print_error(
                        "Error: moxxy Gateway is not running. Please run 'moxxy gateway start' first.",
                    );
                    return Ok(());
                }

                let mut custom_api_url = "".to_string();
                let mut i = 2;
                while i < args.len() {
                    match args[i].as_str() {
                        "--api-url" => {
                            if i + 1 < args.len() {
                                custom_api_url = args[i + 1].clone();
                                i += 2;
                            } else {
                                i += 1;
                            }
                        }
                        _ => i += 1,
                    }
                }

                // Pure client Mode: Boot the TUI Interface directly without loading agent vaults or workspaces
                let mut cli = CliInterface::new(custom_api_url);
                cli.run_tui().await?;
                return Ok(());
            }
            "dev" => {
                run_mode = RunMode::Dev;
            }
            "install" => {
                install::run_install().await?;
                return Ok(());
            }
            "init" | "onboard" => {
                onboarding::run_onboarding().await?;
                return Ok(());
            }
            "migrate" => {
                migrate::run_migration_wizard().await?;
                return Ok(());
            }
            "channel" => {
                let sub_cmd = if args.len() > 2 { args[2].as_str() } else { "" };
                match sub_cmd {
                    "telegram" => {
                        let mut agent_arg: Option<String> = None;
                        let mut token_arg: Option<String> = None;
                        let mut pair_code_arg: Option<String> = None;
                        let mut show_help = false;
                        let mut i = 3;
                        while i < args.len() {
                            match args[i].as_str() {
                                "--help" | "-h" => {
                                    show_help = true;
                                    i += 1;
                                }
                                "--agent" | "-a" => {
                                    if i + 1 < args.len() {
                                        agent_arg = Some(args[i + 1].clone());
                                        i += 2;
                                    } else {
                                        i += 1;
                                    }
                                }
                                "--token" => {
                                    if i + 1 < args.len() {
                                        token_arg = Some(args[i + 1].clone());
                                        i += 2;
                                    } else {
                                        i += 1;
                                    }
                                }
                                "--pair-code" | "-c" => {
                                    if i + 1 < args.len() {
                                        pair_code_arg = Some(args[i + 1].clone());
                                        i += 2;
                                    } else {
                                        i += 1;
                                    }
                                }
                                _ => i += 1,
                            }
                        }
                        if show_help {
                            println!(
                                "{}\n",
                                style("moxxy channel telegram - Configure and pair a Telegram bot")
                                    .bold()
                            );
                            println!("{}", style("Usage:").bold());
                            println!("  moxxy channel telegram [OPTIONS]\n");
                            println!("{}", style("Options:").bold());
                            println!(
                                "  --agent, -a <name>       Agent to bind the bot to (default: \"default\")"
                            );
                            println!("  --token <bot_token>      Bot token from @BotFather");
                            println!(
                                "  --pair-code, -c <code>   6-digit pairing code from the bot"
                            );
                            println!("  --help, -h               Show this help message\n");
                            println!("{}", style("Examples:").bold());
                            println!("  moxxy channel telegram");
                            println!("  moxxy channel telegram --agent mybot");
                            println!("  moxxy channel telegram --token 123456:ABC-DEF");
                            println!("  moxxy channel telegram --pair-code 123456\n");
                            println!("{}", style("Interactive mode:").bold());
                            println!(
                                "  Run without arguments to enter the interactive setup wizard."
                            );
                            println!(
                                "  If a token is already configured, you can replace it or disconnect."
                            );
                        } else {
                            channels::run_channel_telegram(agent_arg, token_arg, pair_code_arg)
                                .await?;
                        }
                    }
                    "discord" => {
                        let mut agent_arg: Option<String> = None;
                        let mut token_arg: Option<String> = None;
                        let mut show_help = false;
                        let mut i = 3;
                        while i < args.len() {
                            match args[i].as_str() {
                                "--help" | "-h" => {
                                    show_help = true;
                                    i += 1;
                                }
                                "--agent" | "-a" => {
                                    if i + 1 < args.len() {
                                        agent_arg = Some(args[i + 1].clone());
                                        i += 2;
                                    } else {
                                        i += 1;
                                    }
                                }
                                "--token" => {
                                    if i + 1 < args.len() {
                                        token_arg = Some(args[i + 1].clone());
                                        i += 2;
                                    } else {
                                        i += 1;
                                    }
                                }
                                _ => i += 1,
                            }
                        }
                        if show_help {
                            println!(
                                "{}\n",
                                style("moxxy channel discord - Configure a Discord bot").bold()
                            );
                            println!("{}", style("Usage:").bold());
                            println!("  moxxy channel discord [OPTIONS]\n");
                            println!("{}", style("Options:").bold());
                            println!(
                                "  --agent, -a <name>    Agent to bind the bot to (default: \"default\")"
                            );
                            println!(
                                "  --token <bot_token>   Bot token from Discord Developer Portal"
                            );
                            println!("  --help, -h            Show this help message\n");
                            println!("{}", style("Examples:").bold());
                            println!("  moxxy channel discord");
                            println!("  moxxy channel discord --agent mybot");
                            println!("  moxxy channel discord --token YOUR_BOT_TOKEN");
                        } else {
                            channels::run_channel_discord(agent_arg, token_arg).await?;
                        }
                    }
                    _ => {
                        println!("{}", style("Usage: moxxy channel <type>").bold());
                        println!("  • telegram   Configure and pair a Telegram bot");
                        println!(
                            "               Options: --agent <name> [--token <bot_token>] [--pair-code <6digits>]"
                        );
                        println!("  • discord    Configure a Discord bot");
                        println!("               Options: --agent <name> [--token <bot_token>]");
                    }
                }
                return Ok(());
            }
            "agent" => {
                agent_cmd::run_agent_command(&args).await?;
                return Ok(());
            }
            "webhook" | "webhooks" => {
                webhooks::run_webhook_command(&args).await?;
                return Ok(());
            }
            "update" => {
                update::run_update().await?;
                return Ok(());
            }
            "uninstall" => {
                uninstall::run_uninstall().await?;
                return Ok(());
            }
            "doctor" => {
                let mut fix = false;
                if args.len() > 2 && args[2] == "--fix" {
                    fix = true;
                }
                doctor::run_doctor(fix).await?;
                return Ok(());
            }
            "help" | "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            _ => {
                print_error(&format!("Unknown command: {}", cmd));
                print_help();
                return Ok(());
            }
        }
    } else {
        print_help();
        return Ok(());
    }

    swarm::run_swarm_engine(run_mode, target_agent, api_host, api_port, web_port).await
}
