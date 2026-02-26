use anyhow::Result;
use crossterm::{
    event::{
        self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
        Event, KeyCode, KeyModifiers,
    },
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};

/// When input exceeds this length (e.g. from paste), show a placeholder instead of raw text
/// to avoid terminal display overflow and overlapping with subsequent UI.
const PASTE_DISPLAY_THRESHOLD: usize = 100;
use ratatui::{
    Terminal,
    backend::Backend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Style},
    widgets::{Block, Borders, Clear, Paragraph},
};
use std::{io, time::Duration};
use tokio::sync::mpsc;

use super::{COMMANDS, CliInterface, StreamEvent};

impl CliInterface {
    pub async fn run_tui(&mut self) -> Result<()> {
        self.load_history().await;
        self.scroll_to_bottom();

        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(
            stdout,
            EnterAlternateScreen,
            EnableMouseCapture,
            EnableBracketedPaste
        )?;
        let backend = ratatui::backend::CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        let res = self.run_app(&mut terminal).await;

        disable_raw_mode()?;
        execute!(
            terminal.backend_mut(),
            LeaveAlternateScreen,
            DisableMouseCapture,
            DisableBracketedPaste
        )?;
        terminal.show_cursor()?;

        res
    }

    async fn run_app<B: Backend>(&mut self, terminal: &mut Terminal<B>) -> Result<()>
    where
        <B as Backend>::Error: std::error::Error + Send + Sync + 'static,
    {
        loop {
            if self.should_quit {
                return Ok(());
            }

            // Check for brain stream events (non-blocking, drain all available)
            {
                let mut events: Vec<StreamEvent> = Vec::new();
                let mut disconnected = false;
                if let Some(ref mut rx) = self.brain_rx {
                    loop {
                        match rx.try_recv() {
                            Ok(event) => events.push(event),
                            Err(mpsc::error::TryRecvError::Empty) => break,
                            Err(mpsc::error::TryRecvError::Disconnected) => {
                                disconnected = true;
                                break;
                            }
                        }
                    }
                }
                for event in events {
                    match event {
                        StreamEvent::Activity(text) => {
                            self.push_cmd_output(text.clone());
                            self.thinking_text = text;
                        }
                        StreamEvent::Response(response) => {
                            // Final responses are rendered from shared STM polling to avoid duplicates.
                            if response.is_empty() {
                                self.thinking_text.clear();
                            }
                        }
                        StreamEvent::Error(e) => {
                            self.push_system(format!("Error: {}", e));
                            self.scroll_to_bottom();
                        }
                        StreamEvent::Done => {
                            self.is_thinking = false;
                            self.thinking_text.clear();
                            self.brain_rx = None;
                        }
                    }
                }
                if disconnected {
                    self.is_thinking = false;
                    self.thinking_text.clear();
                    self.push_system("Brain task disconnected unexpectedly".to_string());
                    self.brain_rx = None;
                }
            }

            if self.last_session_poll.elapsed() >= Duration::from_millis(900) {
                self.last_session_poll = std::time::Instant::now();
                self.fetch_session_updates().await;
            }

            // Tick thinking animation
            if self.is_thinking {
                self.thinking_tick = self.thinking_tick.wrapping_add(1);
            }

            // Draw
            let active_agent = self.active_agent.clone();
            let input_buf = self.input_buffer.clone();
            let cursor_pos = self.cursor_pos;
            let is_thinking = self.is_thinking;

            let cmd_output_visible = self.cmd_output_visible;
            let autocomplete_visible = self.autocomplete_visible;

            terminal.draw(|f| {
                // Build dynamic layout constraints
                let mut constraints = vec![Constraint::Min(1)];
                if cmd_output_visible {
                    // Command output panel: auto-size to content, capped at 12 lines
                    let output_height = (self.cmd_output_lines.len() as u16 + 2).min(12);
                    constraints.push(Constraint::Length(output_height));
                }
                constraints.push(Constraint::Length(3));

                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints(constraints)
                    .split(f.area());

                let chat_idx = 0;
                let input_idx = if cmd_output_visible { 2 } else { 1 };

                // Chat area
                let (chat_widget, _max_scroll) = self.render_messages(chunks[chat_idx]);
                f.render_widget(chat_widget, chunks[chat_idx]);

                // Command output panel (if visible)
                if cmd_output_visible {
                    let cmd_widget = self.render_cmd_output(chunks[1]);
                    f.render_widget(cmd_widget, chunks[1]);
                }

                // Input area - show placeholder for pasted/long content to avoid display overflow
                let prompt_label = format!("{} > ", active_agent);
                let displayed_input = if input_buf.len() > PASTE_DISPLAY_THRESHOLD {
                    format!("[Pasted content - {} chars]", input_buf.len())
                } else {
                    input_buf.clone()
                };
                let input_text = format!("{}{}", prompt_label, displayed_input);

                let input_style = if is_thinking {
                    Style::default().fg(Color::DarkGray)
                } else {
                    Style::default().fg(Color::White)
                };

                let input_widget = Paragraph::new(input_text)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_style(Style::default().fg(Color::DarkGray)),
                    )
                    .style(input_style);
                f.render_widget(input_widget, chunks[input_idx]);

                // Autocomplete popup overlay
                if autocomplete_visible && !self.autocomplete_candidates.is_empty() {
                    let (popup_widget, popup_area) = self.render_autocomplete(chunks[input_idx]);
                    f.render_widget(Clear, popup_area);
                    f.render_widget(popup_widget, popup_area);
                }

                // Place cursor (when truncated, show at end of placeholder)
                let cursor_display_len = if input_buf.len() > PASTE_DISPLAY_THRESHOLD {
                    displayed_input.len()
                } else {
                    cursor_pos
                };
                let cursor_x =
                    chunks[input_idx].x + 1 + prompt_label.len() as u16 + cursor_display_len as u16;
                let cursor_y = chunks[input_idx].y + 1;
                f.set_cursor_position((cursor_x, cursor_y));
            })?;

            // Poll events with short timeout for animation
            if crossterm::event::poll(Duration::from_millis(80))? {
                match event::read()? {
                    Event::Key(key) => {
                        // Ctrl+C always quits
                        if key.modifiers.contains(KeyModifiers::CONTROL)
                            && key.code == KeyCode::Char('c')
                        {
                            self.should_quit = true;
                            continue;
                        }

                        match key.code {
                            KeyCode::Enter => {
                                if self.autocomplete_visible {
                                    // Accept the selected autocomplete suggestion
                                    if let Some(&cmd_idx) =
                                        self.autocomplete_candidates.get(self.autocomplete_selected)
                                    {
                                        let cmd_name = COMMANDS[cmd_idx].name.to_string();
                                        self.input_buffer = cmd_name.clone();
                                        self.cursor_pos = self.input_buffer.len();
                                        // If the command takes args, add a trailing space
                                        if COMMANDS[cmd_idx].name == "/switch"
                                            || COMMANDS[cmd_idx].name == "/model"
                                        {
                                            self.input_buffer.push(' ');
                                            self.cursor_pos += 1;
                                        }
                                    }
                                    self.autocomplete_visible = false;
                                    self.autocomplete_candidates.clear();
                                } else if !self.input_buffer.is_empty() {
                                    let input = self.input_buffer.clone();
                                    self.input_buffer.clear();
                                    self.cursor_pos = 0;

                                    if input.starts_with('/') {
                                        self.handle_command(&input).await;
                                    } else if !self.is_thinking {
                                        self.submit_chat(input).await;
                                    }
                                }
                            }
                            KeyCode::Tab => {
                                if self.autocomplete_visible {
                                    // Accept the selected autocomplete suggestion
                                    if let Some(&cmd_idx) =
                                        self.autocomplete_candidates.get(self.autocomplete_selected)
                                    {
                                        let cmd_name = COMMANDS[cmd_idx].name.to_string();
                                        self.input_buffer = cmd_name.clone();
                                        self.cursor_pos = self.input_buffer.len();
                                        // If the command takes args, add a trailing space
                                        if COMMANDS[cmd_idx].name == "/switch"
                                            || COMMANDS[cmd_idx].name == "/model"
                                        {
                                            self.input_buffer.push(' ');
                                            self.cursor_pos += 1;
                                        }
                                    }
                                    self.autocomplete_visible = false;
                                    self.autocomplete_candidates.clear();
                                }
                            }
                            KeyCode::Backspace => {
                                if self.cursor_pos > 0 {
                                    self.cursor_pos -= 1;
                                    self.input_buffer.remove(self.cursor_pos);
                                    self.update_autocomplete();
                                }
                            }
                            KeyCode::Delete => {
                                if self.cursor_pos < self.input_buffer.len() {
                                    self.input_buffer.remove(self.cursor_pos);
                                    self.update_autocomplete();
                                }
                            }
                            KeyCode::Left => {
                                if self.cursor_pos > 0 {
                                    self.cursor_pos -= 1;
                                }
                            }
                            KeyCode::Right => {
                                if self.cursor_pos < self.input_buffer.len() {
                                    self.cursor_pos += 1;
                                }
                            }
                            KeyCode::Up => {
                                if self.autocomplete_visible {
                                    if self.autocomplete_selected > 0 {
                                        self.autocomplete_selected -= 1;
                                    }
                                } else {
                                    // Scroll chat up
                                    if self.scroll_offset == u16::MAX {
                                        self.scroll_offset =
                                            (self.messages.len() as u16).saturating_sub(3);
                                    }
                                    self.scroll_offset = self.scroll_offset.saturating_sub(3);
                                }
                            }
                            KeyCode::Down => {
                                if self.autocomplete_visible {
                                    if self.autocomplete_selected + 1
                                        < self.autocomplete_candidates.len()
                                    {
                                        self.autocomplete_selected += 1;
                                    }
                                } else {
                                    // Scroll chat down
                                    if self.scroll_offset != u16::MAX {
                                        self.scroll_offset = self.scroll_offset.saturating_add(3);
                                    }
                                }
                            }
                            KeyCode::Home => {
                                self.cursor_pos = 0;
                            }
                            KeyCode::End => {
                                self.cursor_pos = self.input_buffer.len();
                            }
                            KeyCode::Esc => {
                                if self.autocomplete_visible {
                                    self.autocomplete_visible = false;
                                    self.autocomplete_candidates.clear();
                                } else if self.cmd_output_visible {
                                    self.cmd_output_visible = false;
                                    self.cmd_output_lines.clear();
                                } else {
                                    self.input_buffer.clear();
                                    self.cursor_pos = 0;
                                }
                            }
                            KeyCode::PageUp => {
                                if self.scroll_offset == u16::MAX {
                                    // Need to compute real max first - approximate
                                    self.scroll_offset =
                                        (self.messages.len() as u16).saturating_sub(10);
                                }
                                self.scroll_offset = self.scroll_offset.saturating_sub(10);
                            }
                            KeyCode::PageDown => {
                                if self.scroll_offset != u16::MAX {
                                    self.scroll_offset = self.scroll_offset.saturating_add(10);
                                    // Will be clamped during render
                                }
                            }
                            KeyCode::Char(c) => {
                                self.input_buffer.insert(self.cursor_pos, c);
                                self.cursor_pos += 1;
                                self.update_autocomplete();
                            }
                            _ => {}
                        }
                    }
                    Event::Paste(data) => {
                        self.input_buffer.insert_str(self.cursor_pos, &data);
                        self.cursor_pos += data.chars().count();
                        self.update_autocomplete();
                    }
                    _ => {}
                }
            }
        }
    }
}
