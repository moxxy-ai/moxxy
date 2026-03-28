mod commands;
mod events;
mod history;
mod stream;
mod ui;

use anyhow::Result;
use async_trait::async_trait;
use reqwest::Client;
use std::time::Instant;
use tokio::sync::mpsc;
use tracing::info;

use crate::core::agent::RunMode;
use crate::core::lifecycle::LifecycleComponent;

struct CommandInfo {
    name: &'static str,
    description: &'static str,
}

const COMMANDS: &[CommandInfo] = &[
    CommandInfo {
        name: "/help",
        description: "Show all available commands",
    },
    CommandInfo {
        name: "/agents",
        description: "List or switch agent (/agents [name])",
    },
    CommandInfo {
        name: "/models",
        description: "Show LLM config for active agent",
    },
    CommandInfo {
        name: "/clear",
        description: "Clear chat display",
    },
    CommandInfo {
        name: "/quit",
        description: "Exit the TUI",
    },
    CommandInfo {
        name: "/exit",
        description: "Exit the TUI",
    },
    CommandInfo {
        name: "/vault",
        description: "List keys or set a key (/vault [set key value])",
    },
];

#[derive(Debug, Clone, PartialEq, Eq)]
enum StreamEvent {
    Activity(String),
    Response(String),
    Error(String),
    Done,
}

#[derive(Clone)]
enum MessageRole {
    User,
    Agent,
    System,
}

#[derive(Clone)]
struct DisplayMessage {
    role: MessageRole,
    content: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ModelOption {
    provider_id: String,
    provider_name: String,
    model_id: String,
    model_name: String,
    deployment: Option<String>,
    is_current: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ModelProvider {
    provider_id: String,
    provider_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ModelPickerEntry {
    Section(String),
    Model(ModelOption),
    Custom {
        provider_id: String,
        provider_name: String,
        is_current: bool,
        current_model_id: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ModelPickerFocus {
    Search,
    List,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ModelPickerMode {
    Browse,
    CustomInput {
        provider_id: String,
        provider_name: String,
    },
}

pub struct CliInterface {
    run_mode: RunMode,
    client: Client,
    api_base: String,

    // TUI state
    active_agent: String,
    input_buffer: String,
    cursor_pos: usize,
    messages: Vec<DisplayMessage>,
    scroll_offset: u16,
    is_thinking: bool,
    thinking_tick: usize,
    should_quit: bool,
    brain_rx: Option<mpsc::Receiver<StreamEvent>>,
    thinking_text: String,

    // Autocomplete state
    autocomplete_visible: bool,
    autocomplete_selected: usize,
    autocomplete_candidates: Vec<usize>, // indices into COMMANDS

    // Command output panel
    cmd_output_lines: Vec<String>,
    cmd_output_visible: bool,
    session_last_id: i64,
    last_session_poll: Instant,

    // Model picker state
    model_picker_visible: bool,
    model_picker_query: String,
    model_picker_focus: ModelPickerFocus,
    model_picker_selected: usize,
    model_picker_scroll: u16,
    model_picker_providers: Vec<ModelProvider>,
    model_picker_models: Vec<ModelOption>,
    model_picker_entries: Vec<ModelPickerEntry>,
    model_picker_status: Option<String>,
    model_picker_mode: ModelPickerMode,
    model_picker_custom_input: String,
}

impl CliInterface {
    pub fn new(custom_api_url: String) -> Self {
        let api_base = if custom_api_url.is_empty() {
            "http://127.0.0.1:17890/api".to_string()
        } else {
            custom_api_url
        };

        Self {
            run_mode: RunMode::Tui,
            client: Client::new(),
            api_base,
            active_agent: "default".to_string(),
            input_buffer: String::new(),
            cursor_pos: 0,
            messages: vec![],
            scroll_offset: 0,
            is_thinking: false,
            thinking_tick: 0,
            should_quit: false,
            brain_rx: None,
            thinking_text: String::new(),
            autocomplete_visible: false,
            autocomplete_selected: 0,
            autocomplete_candidates: vec![],
            cmd_output_lines: vec![],
            cmd_output_visible: false,
            session_last_id: 0,
            last_session_poll: Instant::now(),
            model_picker_visible: false,
            model_picker_query: String::new(),
            model_picker_focus: ModelPickerFocus::List,
            model_picker_selected: 0,
            model_picker_scroll: 0,
            model_picker_providers: vec![],
            model_picker_models: vec![],
            model_picker_entries: vec![],
            model_picker_status: None,
            model_picker_mode: ModelPickerMode::Browse,
            model_picker_custom_input: String::new(),
        }
    }

    fn update_autocomplete(&mut self) {
        // Show autocomplete only when input starts with '/' and has no space yet
        if self.input_buffer.starts_with('/') && !self.input_buffer.contains(' ') {
            let prefix = &self.input_buffer;
            self.autocomplete_candidates = COMMANDS
                .iter()
                .enumerate()
                .filter(|(_, c)| c.name.starts_with(prefix))
                .map(|(i, _)| i)
                .collect();
            if !self.autocomplete_candidates.is_empty() {
                self.autocomplete_visible = true;
                // Clamp selection
                if self.autocomplete_selected >= self.autocomplete_candidates.len() {
                    self.autocomplete_selected = self.autocomplete_candidates.len() - 1;
                }
            } else {
                self.autocomplete_visible = false;
                self.autocomplete_selected = 0;
            }
        } else {
            self.autocomplete_visible = false;
            self.autocomplete_selected = 0;
            self.autocomplete_candidates.clear();
        }
    }

    fn push_cmd_output(&mut self, msg: String) {
        self.cmd_output_lines.push(msg);
        self.cmd_output_visible = true;
    }

    fn push_system(&mut self, msg: String) {
        self.messages.push(DisplayMessage {
            role: MessageRole::System,
            content: msg,
        });
        self.scroll_to_bottom();
    }

    fn scroll_to_bottom(&mut self) {
        // Set to a large value; rendering will clamp it
        self.scroll_offset = u16::MAX;
    }
}

#[async_trait]
impl LifecycleComponent for CliInterface {
    async fn on_init(&mut self) -> Result<()> {
        info!("CLI Interface initializing...");
        Ok(())
    }

    async fn on_start(&mut self) -> Result<()> {
        info!("CLI Interface starting TUI...");

        // Use a background task since TUI blocks
        tokio::spawn(async move {
            let mut cli = CliInterface::new(String::new());
            if let Err(e) = cli.run_tui().await {
                tracing::error!("TUI Error: {:?}", e);
            }
            // Once TUI ends, gracefully exit the process if it's strictly a TUI shell
            crate::core::terminal::print_goodbye();
            std::process::exit(0);
        });
        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        info!("CLI Interface shutting down...");
        Ok(())
    }
}
