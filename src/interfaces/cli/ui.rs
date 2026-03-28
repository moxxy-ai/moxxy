use ratatui::{
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
};

use super::{COMMANDS, CliInterface, CommandInfo, MessageRole, ModelPickerEntry, ModelPickerMode};

impl CliInterface {
    pub(super) fn render_messages(&self, area: Rect) -> (Paragraph<'_>, u16) {
        let mut lines: Vec<Line> = Vec::new();

        for msg in &self.messages {
            let (prefix, style, content_style) = match msg.role {
                MessageRole::User => (
                    "  > ",
                    Style::default().fg(Color::Cyan),
                    Style::default().fg(Color::White),
                ),
                MessageRole::Agent => (
                    "  ",
                    Style::default().fg(Color::Green),
                    Style::default().fg(Color::Green),
                ),
                MessageRole::System => (
                    "  ",
                    Style::default().fg(Color::DarkGray),
                    Style::default().fg(Color::DarkGray),
                ),
            };

            // Render content with basic markdown support
            for text_line in msg.content.lines() {
                let spans = parse_inline_markdown(text_line, content_style);
                let prefix_span = Span::styled(prefix, style);
                let mut all_spans = vec![prefix_span];
                all_spans.extend(spans);
                lines.push(Line::from(all_spans));
            }
            lines.push(Line::from("")); // spacing between messages
        }

        // Add thinking indicator
        if self.is_thinking {
            let frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
            let frame = frames[self.thinking_tick % frames.len()];
            let label = if self.thinking_text.is_empty() {
                "Thinking...".to_string()
            } else {
                self.thinking_text.clone()
            };
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled(
                    format!("{} {}", frame, label),
                    Style::default().fg(Color::Yellow),
                ),
            ]));
        }

        let total_lines = lines.len() as u16;
        let visible_height = area.height.saturating_sub(2); // borders

        // Clamp scroll offset
        let max_scroll = total_lines.saturating_sub(visible_height);
        let scroll = if self.scroll_offset == u16::MAX {
            max_scroll
        } else {
            self.scroll_offset.min(max_scroll)
        };

        let paragraph = Paragraph::new(lines)
            .block(
                Block::default()
                    .title(format!(
                        " moxxy [{}] ({:?}) ",
                        self.active_agent, self.run_mode
                    ))
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::DarkGray)),
            )
            .wrap(Wrap { trim: false })
            .scroll((scroll, 0));

        (paragraph, max_scroll)
    }

    pub(super) fn render_cmd_output(&self, _area: Rect) -> Paragraph<'_> {
        let lines: Vec<Line> = self
            .cmd_output_lines
            .iter()
            .map(|l| {
                Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled(l.as_str(), Style::default().fg(Color::Cyan)),
                ])
            })
            .collect();

        Paragraph::new(lines)
            .block(
                Block::default()
                    .title(" Command Output (Esc to dismiss) ")
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Magenta)),
            )
            .wrap(Wrap { trim: false })
    }

    pub(super) fn render_autocomplete(&self, input_area: Rect) -> (Paragraph<'_>, Rect) {
        let num_items = self.autocomplete_candidates.len() as u16;
        let popup_height = num_items + 2; // +2 for borders
        let popup_width = 42;

        let popup_area = Rect {
            x: input_area.x + 1,
            y: input_area.y.saturating_sub(popup_height),
            width: popup_width.min(input_area.width.saturating_sub(2)),
            height: popup_height,
        };

        let lines: Vec<Line> = self
            .autocomplete_candidates
            .iter()
            .enumerate()
            .map(|(i, &cmd_idx)| {
                let cmd: &CommandInfo = &COMMANDS[cmd_idx];
                let is_selected = i == self.autocomplete_selected;
                let style = if is_selected {
                    Style::default()
                        .fg(Color::Black)
                        .bg(Color::Cyan)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                };
                let desc_style = if is_selected {
                    Style::default().fg(Color::DarkGray).bg(Color::Cyan)
                } else {
                    Style::default().fg(Color::DarkGray)
                };
                Line::from(vec![
                    Span::styled(format!(" {:<12}", cmd.name), style),
                    Span::styled(format!(" {}", cmd.description), desc_style),
                ])
            })
            .collect();

        let widget = Paragraph::new(lines).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        );

        (widget, popup_area)
    }

    pub(super) fn model_picker_area(&self, outer: Rect) -> Rect {
        let width = outer.width.min(72).max(40);
        let desired_height = match self.model_picker_mode {
            ModelPickerMode::Browse => (self.model_picker_entries.len() as u16 + 7).min(22),
            ModelPickerMode::CustomInput { .. } => 10,
        };
        let height = outer.height.min(desired_height.max(10)).max(10);

        let [vertical] = Layout::vertical([Constraint::Length(height)])
            .flex(ratatui::layout::Flex::Center)
            .areas(outer);
        let [horizontal] = Layout::horizontal([Constraint::Length(width)])
            .flex(ratatui::layout::Flex::Center)
            .areas(vertical);
        horizontal
    }

    pub(super) fn model_picker_block(&self) -> Block<'_> {
        Block::default()
            .title(" Select model ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Cyan))
    }

    pub(super) fn model_picker_browse_areas(&self, area: Rect) -> (Rect, Rect, Rect) {
        let inner = self.model_picker_block().inner(area);
        let [search_area, list_area, footer_area] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(1),
        ])
        .areas(inner);
        (search_area, list_area, footer_area)
    }

    pub(super) fn render_model_picker_search(&self) -> Paragraph<'_> {
        Paragraph::new(Line::from(vec![
            Span::styled("Search: ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                self.model_picker_query.as_str(),
                Style::default().fg(Color::White),
            ),
        ]))
    }

    pub(super) fn render_model_picker_list(&self, area: Rect) -> Paragraph<'_> {
        let visible_rows = area.height as usize;
        let start = self.model_picker_scroll as usize;
        let end = (start + visible_rows).min(self.model_picker_entries.len());
        let mut lines = Vec::new();

        for (index, entry) in self
            .model_picker_entries
            .iter()
            .enumerate()
            .skip(start)
            .take(end.saturating_sub(start))
        {
            match entry {
                ModelPickerEntry::Section(name) => {
                    lines.push(Line::from(vec![Span::styled(
                        format!(" {}", name),
                        Style::default()
                            .fg(Color::Magenta)
                            .add_modifier(Modifier::BOLD),
                    )]));
                }
                ModelPickerEntry::Model(model) => {
                    let is_selected = self.model_picker_selected == index;
                    let prefix = if model.is_current { "●" } else { " " };
                    let deployment = match model.deployment.as_deref() {
                        Some("local") => "[Local] ",
                        Some("cloud") => "[Cloud] ",
                        _ => "",
                    };
                    let base_style = if is_selected {
                        Style::default().fg(Color::Black).bg(Color::Cyan)
                    } else {
                        Style::default().fg(Color::White)
                    };
                    let badge_style = if is_selected {
                        Style::default()
                            .fg(Color::Black)
                            .bg(Color::Cyan)
                            .add_modifier(Modifier::BOLD)
                    } else if model.deployment.as_deref() == Some("cloud") {
                        Style::default().fg(Color::Blue)
                    } else {
                        Style::default().fg(Color::Green)
                    };

                    lines.push(Line::from(vec![
                        Span::styled(format!(" {} ", prefix), base_style),
                        Span::styled(deployment.to_string(), badge_style),
                        Span::styled(model.model_name.as_str(), base_style),
                        Span::styled(
                            format!("  {}", model.provider_name),
                            if is_selected {
                                Style::default().fg(Color::DarkGray).bg(Color::Cyan)
                            } else {
                                Style::default().fg(Color::DarkGray)
                            },
                        ),
                    ]));
                }
                ModelPickerEntry::Custom {
                    provider_name,
                    is_current,
                    current_model_id,
                    ..
                } => {
                    let is_selected = self.model_picker_selected == index;
                    let base_style = if is_selected {
                        Style::default().fg(Color::Black).bg(Color::Cyan)
                    } else {
                        Style::default().fg(Color::Yellow)
                    };
                    let tail = current_model_id
                        .as_ref()
                        .map(|id| format!("  current: {}", id))
                        .unwrap_or_default();
                    let prefix = if *is_current { "●" } else { "+" };
                    lines.push(Line::from(vec![
                        Span::styled(format!(" {} ", prefix), base_style),
                        Span::styled("Custom model…", base_style),
                        Span::styled(
                            tail,
                            if is_selected {
                                Style::default().fg(Color::DarkGray).bg(Color::Cyan)
                            } else {
                                Style::default().fg(Color::DarkGray)
                            },
                        ),
                        Span::styled(
                            format!("  {}", provider_name),
                            if is_selected {
                                Style::default().fg(Color::DarkGray).bg(Color::Cyan)
                            } else {
                                Style::default().fg(Color::DarkGray)
                            },
                        ),
                    ]));
                }
            }
        }

        Paragraph::new(lines)
    }

    pub(super) fn render_model_picker_footer(&self) -> Paragraph<'_> {
        let footer = self.model_picker_status.clone().unwrap_or_else(|| {
            "Enter select • Esc close • Tab search/list • Type to search".to_string()
        });
        Paragraph::new(Line::from(vec![Span::styled(
            footer,
            Style::default().fg(Color::DarkGray),
        )]))
    }

    pub(super) fn render_model_picker_custom_input(&self) -> Paragraph<'_> {
        let lines = match &self.model_picker_mode {
            ModelPickerMode::CustomInput {
                provider_name,
                provider_id,
            } => vec![
                Line::from(vec![
                    Span::styled(" Provider: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(provider_name.as_str(), Style::default().fg(Color::White)),
                    Span::styled(
                        format!(" ({})", provider_id),
                        Style::default().fg(Color::DarkGray),
                    ),
                ]),
                Line::from(""),
                Line::from(vec![
                    Span::styled(" Model ID: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        self.model_picker_custom_input.as_str(),
                        Style::default().fg(Color::White),
                    ),
                ]),
                Line::from(""),
                Line::from(vec![Span::styled(
                    "Enter confirms • Esc cancels",
                    Style::default().fg(Color::DarkGray),
                )]),
            ],
            ModelPickerMode::Browse => vec![],
        };

        Paragraph::new(lines).block(self.model_picker_block())
    }
}

/// Parse basic inline markdown: **bold**, `code`
pub(super) fn parse_inline_markdown<'a>(text: &'a str, base_style: Style) -> Vec<Span<'a>> {
    let mut spans = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        // Look for **bold** or `code`
        if let Some(pos) = remaining.find("**") {
            if pos > 0 {
                spans.push(Span::styled(&remaining[..pos], base_style));
            }
            let after = &remaining[pos + 2..];
            if let Some(end) = after.find("**") {
                spans.push(Span::styled(
                    &after[..end],
                    base_style.add_modifier(Modifier::BOLD),
                ));
                remaining = &after[end + 2..];
            } else {
                spans.push(Span::styled(&remaining[pos..], base_style));
                break;
            }
        } else if let Some(pos) = remaining.find('`') {
            if pos > 0 {
                spans.push(Span::styled(&remaining[..pos], base_style));
            }
            let after = &remaining[pos + 1..];
            if let Some(end) = after.find('`') {
                spans.push(Span::styled(
                    &after[..end],
                    Style::default().fg(Color::Yellow),
                ));
                remaining = &after[end + 1..];
            } else {
                spans.push(Span::styled(&remaining[pos..], base_style));
                break;
            }
        } else {
            spans.push(Span::styled(remaining, base_style));
            break;
        }
    }

    if spans.is_empty() {
        spans.push(Span::styled("", base_style));
    }

    spans
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interfaces::cli::{CliInterface, ModelPickerMode};

    #[test]
    fn model_picker_browse_areas_reserve_footer_outside_list() {
        let mut cli = CliInterface::new(String::new());
        cli.model_picker_mode = ModelPickerMode::Browse;
        let area = Rect::new(0, 0, 60, 16);

        let (search, list, footer) = cli.model_picker_browse_areas(area);

        assert_eq!(search.height, 1);
        assert_eq!(footer.height, 1);
        assert!(list.height > 0);
        assert!(search.y < list.y);
        assert!(list.y < footer.y);
    }
}
