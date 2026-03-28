use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Terminal,
    backend::Backend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Style},
    widgets::{Block, Borders, Clear, Paragraph},
};
use std::{io, time::Duration};
use tokio::sync::mpsc;

use super::{
    COMMANDS, CliInterface, ModelPickerEntry, ModelPickerMode, StreamEvent,
    commands::build_model_picker_entries,
};

fn drain_brain_events(rx: &mut mpsc::Receiver<StreamEvent>) -> (Vec<StreamEvent>, bool) {
    let mut events = Vec::new();
    let mut disconnected = false;

    loop {
        match rx.try_recv() {
            Ok(event) => events.push(event),
            Err(mpsc::error::TryRecvError::Empty) => break,
            Err(mpsc::error::TryRecvError::Disconnected) => {
                disconnected = !events
                    .iter()
                    .any(|event| matches!(event, StreamEvent::Done));
                break;
            }
        }
    }

    (events, disconnected)
}

fn clamp_model_picker_scroll(selected: usize, scroll: u16, visible_rows: u16) -> u16 {
    if visible_rows == 0 {
        return 0;
    }

    let selected = selected as u16;
    let end = scroll.saturating_add(visible_rows.saturating_sub(1));

    if selected < scroll {
        selected
    } else if selected > end {
        selected.saturating_sub(visible_rows.saturating_sub(1))
    } else {
        scroll
    }
}

impl CliInterface {
    fn refresh_model_picker_entries(&mut self) {
        let current_custom = self
            .model_picker_entries
            .iter()
            .find_map(|entry| match entry {
                ModelPickerEntry::Custom {
                    provider_id,
                    is_current,
                    current_model_id: Some(model_id),
                    ..
                } if *is_current => Some((provider_id.as_str(), model_id.as_str())),
                _ => None,
            });
        self.model_picker_entries = build_model_picker_entries(
            &self.model_picker_providers,
            &self.model_picker_models,
            &self.model_picker_query,
            current_custom,
        );
        if let Some(idx) = self.model_picker_entries.iter().position(|entry| {
            matches!(
                entry,
                ModelPickerEntry::Model(_) | ModelPickerEntry::Custom { .. }
            )
        }) {
            if !matches!(
                self.model_picker_entries.get(self.model_picker_selected),
                Some(ModelPickerEntry::Model(_) | ModelPickerEntry::Custom { .. })
            ) {
                self.model_picker_selected = idx;
            } else if self.model_picker_selected >= self.model_picker_entries.len() {
                self.model_picker_selected = idx;
            }
        } else {
            self.model_picker_selected = 0;
        }
        self.model_picker_scroll = 0;
    }

    fn move_model_picker_selection(&mut self, direction: isize) {
        if self.model_picker_entries.is_empty() {
            return;
        }

        let mut index = self.model_picker_selected as isize;
        loop {
            index += direction;
            if index < 0 || index >= self.model_picker_entries.len() as isize {
                break;
            }
            if matches!(
                self.model_picker_entries.get(index as usize),
                Some(ModelPickerEntry::Model(_) | ModelPickerEntry::Custom { .. })
            ) {
                self.model_picker_selected = index as usize;
                break;
            }
        }
    }

    fn sync_model_picker_scroll(&mut self, visible_rows: u16) {
        self.model_picker_scroll = clamp_model_picker_scroll(
            self.model_picker_selected,
            self.model_picker_scroll,
            visible_rows,
        );
    }

    async fn select_model_picker_entry(&mut self) {
        if let Some(entry) = self
            .model_picker_entries
            .get(self.model_picker_selected)
            .cloned()
        {
            match entry {
                ModelPickerEntry::Model(model) => {
                    self.model_picker_visible = false;
                    self.model_picker_status = None;
                    let command = format!("/models {} {}", model.provider_id, model.model_id);
                    self.handle_command(&command).await;
                }
                ModelPickerEntry::Custom {
                    provider_id,
                    provider_name,
                    current_model_id,
                    ..
                } => {
                    self.model_picker_mode = ModelPickerMode::CustomInput {
                        provider_id,
                        provider_name,
                    };
                    self.model_picker_custom_input = current_model_id.unwrap_or_default();
                    self.model_picker_focus = super::ModelPickerFocus::Search;
                    self.model_picker_status = None;
                }
                ModelPickerEntry::Section(_) => {}
            }
        }
    }

    pub async fn run_tui(&mut self) -> Result<()> {
        self.load_history().await;
        self.scroll_to_bottom();

        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
        let backend = ratatui::backend::CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        let res = self.run_app(&mut terminal).await;

        disable_raw_mode()?;
        execute!(
            terminal.backend_mut(),
            LeaveAlternateScreen,
            DisableMouseCapture
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
                let mut disconnected = false;
                if let Some(ref mut rx) = self.brain_rx {
                    let (drained_events, was_disconnected) = drain_brain_events(rx);
                    disconnected = was_disconnected;
                    for event in drained_events {
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
            let model_picker_visible = self.model_picker_visible;

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

                // Input area
                let prompt_label = format!("{} > ", active_agent);
                let input_text = format!("{}{}", prompt_label, input_buf);

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

                if model_picker_visible {
                    let popup_area = self.model_picker_area(f.area());
                    f.render_widget(Clear, popup_area);

                    match &self.model_picker_mode {
                        ModelPickerMode::Browse => {
                            let (search_area, list_area, footer_area) =
                                self.model_picker_browse_areas(popup_area);
                            self.sync_model_picker_scroll(list_area.height);
                            let block = self.model_picker_block();

                            f.render_widget(block, popup_area);
                            f.render_widget(self.render_model_picker_search(), search_area);
                            f.render_widget(self.render_model_picker_list(list_area), list_area);
                            f.render_widget(self.render_model_picker_footer(), footer_area);

                            if self.model_picker_focus == super::ModelPickerFocus::Search {
                                let cursor_x =
                                    search_area.x + 8 + self.model_picker_query.len() as u16;
                                let cursor_y = search_area.y;
                                f.set_cursor_position((cursor_x, cursor_y));
                            }
                        }
                        ModelPickerMode::CustomInput { .. } => {
                            f.render_widget(self.render_model_picker_custom_input(), popup_area);
                            let cursor_x =
                                popup_area.x + 12 + self.model_picker_custom_input.len() as u16;
                            let cursor_y = popup_area.y + 3;
                            f.set_cursor_position((cursor_x, cursor_y));
                        }
                    }
                    return;
                }

                // Place cursor
                let cursor_x =
                    chunks[input_idx].x + 1 + prompt_label.len() as u16 + cursor_pos as u16;
                let cursor_y = chunks[input_idx].y + 1;
                f.set_cursor_position((cursor_x, cursor_y));
            })?;

            // Poll events with short timeout for animation
            if crossterm::event::poll(Duration::from_millis(80))?
                && let Event::Key(key) = event::read()?
            {
                // Ctrl+C always quits
                if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
                    self.should_quit = true;
                    continue;
                }

                if self.model_picker_visible {
                    match self.model_picker_mode.clone() {
                        ModelPickerMode::Browse => match key.code {
                            KeyCode::Esc => {
                                self.model_picker_visible = false;
                                self.model_picker_status = None;
                            }
                            KeyCode::Enter => {
                                self.select_model_picker_entry().await;
                            }
                            KeyCode::Up => {
                                self.model_picker_focus = super::ModelPickerFocus::List;
                                self.move_model_picker_selection(-1);
                            }
                            KeyCode::Down => {
                                self.model_picker_focus = super::ModelPickerFocus::List;
                                self.move_model_picker_selection(1);
                            }
                            KeyCode::Tab => {
                                self.model_picker_focus = match self.model_picker_focus {
                                    super::ModelPickerFocus::Search => {
                                        super::ModelPickerFocus::List
                                    }
                                    super::ModelPickerFocus::List => {
                                        super::ModelPickerFocus::Search
                                    }
                                };
                            }
                            KeyCode::Backspace => {
                                if self.model_picker_focus == super::ModelPickerFocus::Search {
                                    self.model_picker_query.pop();
                                    self.refresh_model_picker_entries();
                                }
                            }
                            KeyCode::Char(c) => {
                                if self.model_picker_focus == super::ModelPickerFocus::Search {
                                    self.model_picker_query.push(c);
                                    self.refresh_model_picker_entries();
                                }
                            }
                            _ => {}
                        },
                        ModelPickerMode::CustomInput {
                            provider_id,
                            provider_name: _,
                        } => match key.code {
                            KeyCode::Esc => {
                                self.model_picker_mode = ModelPickerMode::Browse;
                                self.model_picker_focus = super::ModelPickerFocus::List;
                            }
                            KeyCode::Enter => {
                                let custom = self.model_picker_custom_input.trim().to_string();
                                if !custom.is_empty() {
                                    self.model_picker_visible = false;
                                    self.model_picker_status = None;
                                    let command = format!("/models {} {}", provider_id, custom);
                                    self.handle_command(&command).await;
                                } else {
                                    self.model_picker_status =
                                        Some("Custom model ID cannot be empty.".to_string());
                                }
                            }
                            KeyCode::Backspace => {
                                self.model_picker_custom_input.pop();
                            }
                            KeyCode::Char(c) => {
                                self.model_picker_custom_input.push(c);
                            }
                            _ => {}
                        },
                    }
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
                                self.scroll_offset = (self.messages.len() as u16).saturating_sub(3);
                            }
                            self.scroll_offset = self.scroll_offset.saturating_sub(3);
                        }
                    }
                    KeyCode::Down => {
                        if self.autocomplete_visible {
                            if self.autocomplete_selected + 1 < self.autocomplete_candidates.len() {
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
                            self.scroll_offset = (self.messages.len() as u16).saturating_sub(10);
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drain_brain_events_treats_done_then_disconnect_as_clean_shutdown() {
        let (tx, mut rx) = mpsc::channel(4);
        tx.try_send(StreamEvent::Done)
            .expect("done event should be queued");
        drop(tx);

        let (events, disconnected) = drain_brain_events(&mut rx);
        assert_eq!(events, vec![StreamEvent::Done]);
        assert!(!disconnected);
    }

    #[test]
    fn drain_brain_events_reports_true_disconnect_without_done() {
        let (tx, mut rx) = mpsc::channel::<StreamEvent>(4);
        drop(tx);

        let (events, disconnected) = drain_brain_events(&mut rx);
        assert!(events.is_empty());
        assert!(disconnected);
    }

    #[test]
    fn clamp_model_picker_scroll_moves_down_when_selection_goes_below_viewport() {
        let scroll = clamp_model_picker_scroll(12, 0, 5);
        assert_eq!(scroll, 8);
    }

    #[test]
    fn clamp_model_picker_scroll_moves_up_when_selection_goes_above_viewport() {
        let scroll = clamp_model_picker_scroll(2, 6, 5);
        assert_eq!(scroll, 2);
    }

    #[test]
    fn move_model_picker_selection_can_land_on_custom_entry() {
        let mut cli = CliInterface::new(String::new());
        cli.model_picker_entries = vec![
            ModelPickerEntry::Section("Ollama".to_string()),
            ModelPickerEntry::Model(super::super::ModelOption {
                provider_id: "ollama".to_string(),
                provider_name: "Ollama".to_string(),
                model_id: "gpt-oss:20b".to_string(),
                model_name: "gpt-oss:20b".to_string(),
                deployment: Some("local".to_string()),
                is_current: false,
            }),
            ModelPickerEntry::Custom {
                provider_id: "ollama".to_string(),
                provider_name: "Ollama".to_string(),
                is_current: false,
                current_model_id: None,
            },
        ];
        cli.model_picker_selected = 1;

        cli.move_model_picker_selection(1);

        assert_eq!(cli.model_picker_selected, 2);
    }
}
