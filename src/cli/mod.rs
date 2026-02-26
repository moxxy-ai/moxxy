mod agent_cmd;
mod channels;
mod daemon;
mod doctor;
mod install;
mod migrate;
mod oauth;
mod onboarding;
mod orchestrator;
mod swarm;
mod tokens;
mod uninstall;
mod update;
mod webhooks;

use anyhow::Result;
use console::style;

use crate::core::agent::RunMode;
use crate::core::terminal::{self, GuideSection, print_error};
use crate::interfaces::cli::CliInterface;

fn print_help() {
    terminal::print_banner();

    GuideSection::new("Core")
        .command("web", "Start the Web Dashboard")
        .command("tui", "Start the Interactive Terminal UI")
        .command("run", "Run a single programmatic prompt")
        .print();

    GuideSection::new("Setup")
        .command("install", "Set up directories and database")
        .command("init", "Run the Onboarding Wizard")
        .command("migrate", "Migrate from OpenClaw to Moxxy")
        .print();

    GuideSection::new("Management")
        .command("gateway", "Manage the background daemon process")
        .command("agent", "Manage agents")
        .command("orchestrator", "Manage orchestration config/templates/jobs")
        .command("channel", "Manage channel connections")
        .command("webhook", "Manage webhook endpoints")
        .command("oauth", "Run OAuth flows for skills")
        .print();

    GuideSection::new("Diagnostics")
        .command("doctor", "Check system dependencies")
        .command("logs", "Follow real-time daemon logs")
        .command("update", "Update moxxy to the latest version")
        .command("uninstall", "Remove moxxy binary and all data")
        .print();

    println!(
        "\n {} {} <command> [subcommand]\n",
        style("Usage:").bold(),
        style("moxxy").green()
    );
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunCommandArgs {
    pub agent: String,
    pub prompt: String,
}

pub(crate) fn parse_run_command_args(args: &[String], start: usize) -> RunCommandArgs {
    let mut agent = "default".to_string();
    let mut prompt = String::new();
    let mut i = start;
    while i < args.len() {
        match args[i].as_str() {
            "--agent" | "-a" => {
                if i + 1 < args.len() {
                    agent = args[i + 1].clone();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--prompt" | "-p" => {
                if i + 1 < args.len() {
                    prompt = args[i + 1].clone();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
    RunCommandArgs { agent, prompt }
}

pub(crate) fn parse_api_server_flags(
    args: &[String],
    start: usize,
    mut api_host: String,
    mut api_port: u16,
) -> (String, u16) {
    let mut i = start;
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
    (api_host, api_port)
}

pub(crate) fn parse_web_command_flags(
    args: &[String],
    start: usize,
    mut api_host: String,
    mut api_port: u16,
    mut web_port: u16,
) -> (String, u16, u16) {
    let mut i = start;
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

    (api_host, api_port, web_port)
}

pub(crate) fn parse_tui_command_flags(args: &[String], start: usize) -> String {
    let mut custom_api_url = "".to_string();
    let mut i = start;
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
    custom_api_url
}

pub async fn run_main() -> Result<()> {
    let run_mode;
    let args: Vec<String> = std::env::args().collect();
    use crate::platform::{NativePlatform, Platform};
    let run_dir = NativePlatform::data_dir().join("run");
    let pid_file = run_dir.join("moxxy.pid");

    let mut target_agent: Option<String> = None;
    let mut api_host = "127.0.0.1".to_string();
    let mut api_port: u16 = 17890;
    let mut web_port: u16 = 3001;

    // Load global config from default agent's vault if it exists
    let default_agent_dir = NativePlatform::data_dir().join("agents").join("default");
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
                let parsed = parse_run_command_args(&args, 2);
                if parsed.prompt.is_empty() {
                    print_error("Error: --prompt is required for run mode.");
                    print_help();
                    return Ok(());
                }
                target_agent = Some(parsed.agent);
                run_mode = RunMode::Headless(parsed.prompt);
            }
            "gateway" => {
                let moxxy_dir = NativePlatform::data_dir();
                if !moxxy_dir.exists() {
                    print_error(
                        "moxxy is not set up yet. Run 'moxxy init' or 'moxxy install' first.",
                    );
                    return Ok(());
                }
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
                    "token" => {
                        tokens::run_token_command(&args).await?;
                        return Ok(());
                    }
                    _ => {
                        print_error(
                            "Unknown or missing gateway command. Expected: start, stop, restart, status, token",
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
                (api_host, api_port) = parse_api_server_flags(&args, 2, api_host, api_port);
            }
            "web" => {
                if !pid_file.exists() {
                    print_error(
                        "Error: moxxy Gateway is not running. Please run 'moxxy gateway start' first.",
                    );
                    return Ok(());
                }

                (api_host, api_port, web_port) =
                    parse_web_command_flags(&args, 2, api_host, api_port, web_port);

                // Pure frontend server - does NOT boot any agents or API
                use crate::core::lifecycle::LifecycleComponent;
                use crate::interfaces::web::WebServer;

                let mut web = WebServer::new(RunMode::Web, api_host, api_port, web_port);
                web.on_init().await?;
                web.on_start().await?;

                GuideSection::new("Web Dashboard")
                    .status(
                        "Dashboard",
                        &format!(
                            "{}",
                            style(format!("http://127.0.0.1:{}", web_port))
                                .underlined()
                                .cyan()
                        ),
                    )
                    .status("API Endpoint", &format!("http://127.0.0.1:{}", api_port))
                    .blank()
                    .status(
                        "Press Ctrl+C to stop the dashboard.",
                        &format!("{}", style("Ctrl+C").bold().yellow()),
                    )
                    .print();
                println!();

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

                let custom_api_url = parse_tui_command_flags(&args, 2);

                // Pure client Mode: Boot the TUI Interface directly without loading agent vaults or workspaces
                let mut cli = CliInterface::new(custom_api_url);
                cli.run_tui().await?;
                return Ok(());
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
                            GuideSection::new("moxxy channel telegram")
                                .text("Configure and pair a Telegram bot.")
                                .blank()
                                .text(
                                    "--agent, -a <name>       Agent to bind (default: \"default\")",
                                )
                                .text("--token <bot_token>      Bot token from @BotFather")
                                .text("--pair-code, -c <code>   6-digit pairing code from the bot")
                                .text("--help, -h               Show this help message")
                                .blank()
                                .hint("moxxy channel telegram", "")
                                .hint("moxxy channel telegram --agent mybot", "")
                                .hint("moxxy channel telegram --token 123456:ABC-DEF", "")
                                .blank()
                                .text("Run without arguments for the interactive setup wizard.")
                                .print();
                            println!();
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
                            GuideSection::new("moxxy channel discord")
                                .text("Configure a Discord bot.")
                                .blank()
                                .text("--agent, -a <name>    Agent to bind (default: \"default\")")
                                .text("--token <bot_token>   Bot token from Developer Portal")
                                .text("--help, -h            Show this help message")
                                .blank()
                                .hint("moxxy channel discord", "")
                                .hint("moxxy channel discord --agent mybot", "")
                                .hint("moxxy channel discord --token YOUR_BOT_TOKEN", "")
                                .print();
                            println!();
                        } else {
                            channels::run_channel_discord(agent_arg, token_arg).await?;
                        }
                    }
                    _ => {
                        GuideSection::new("moxxy channel")
                            .command("telegram", "Configure and pair a Telegram bot")
                            .command("discord", "Configure a Discord bot")
                            .blank()
                            .text(
                                "Options: --agent <name>  --token <bot_token>  --pair-code <code>",
                            )
                            .print();
                        println!();
                    }
                }
                return Ok(());
            }
            "agent" => {
                agent_cmd::run_agent_command(&args).await?;
                return Ok(());
            }
            "orchestrator" | "orchestrate" => {
                orchestrator::run_orchestrator_command(&args).await?;
                return Ok(());
            }
            "oauth" => {
                oauth::run_oauth_command(&args).await?;
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

#[cfg(test)]
mod tests {
    use super::{
        parse_api_server_flags, parse_run_command_args, parse_tui_command_flags,
        parse_web_command_flags,
    };

    #[test]
    fn parse_run_command_args_reads_agent_and_prompt() {
        let args = vec![
            "moxxy".to_string(),
            "run".to_string(),
            "--agent".to_string(),
            "tester".to_string(),
            "--prompt".to_string(),
            "hello".to_string(),
        ];
        let parsed = parse_run_command_args(&args, 2);
        assert_eq!(parsed.agent, "tester");
        assert_eq!(parsed.prompt, "hello");
    }

    #[test]
    fn parse_api_server_flags_reads_host_and_port() {
        let args = vec![
            "moxxy".to_string(),
            "daemon-run".to_string(),
            "--api-host".to_string(),
            "0.0.0.0".to_string(),
            "--api-port".to_string(),
            "19000".to_string(),
        ];
        let (host, port) = parse_api_server_flags(&args, 2, "127.0.0.1".to_string(), 17890);
        assert_eq!(host, "0.0.0.0");
        assert_eq!(port, 19000);
    }

    #[test]
    fn parse_web_command_flags_reads_three_ports() {
        let args = vec![
            "moxxy".to_string(),
            "web".to_string(),
            "--api-host".to_string(),
            "localhost".to_string(),
            "--api-port".to_string(),
            "18181".to_string(),
            "--port".to_string(),
            "3333".to_string(),
        ];
        let (host, api_port, web_port) =
            parse_web_command_flags(&args, 2, "127.0.0.1".to_string(), 17890, 3001);
        assert_eq!(host, "localhost");
        assert_eq!(api_port, 18181);
        assert_eq!(web_port, 3333);
    }

    #[test]
    fn parse_tui_command_flags_reads_custom_api_url() {
        let args = vec![
            "moxxy".to_string(),
            "tui".to_string(),
            "--api-url".to_string(),
            "http://127.0.0.1:19090".to_string(),
        ];
        let custom_api_url = parse_tui_command_flags(&args, 2);
        assert_eq!(custom_api_url, "http://127.0.0.1:19090");
    }
}
