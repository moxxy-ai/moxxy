use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
};

use super::{COMMANDS, CliInterface, CommandInfo, MessageRole};

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
