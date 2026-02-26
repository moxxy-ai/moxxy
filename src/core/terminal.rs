use console::{Emoji, style};

pub static SUCCESS_ICON: Emoji<'_, '_> = Emoji("", "");
pub static INFO_ICON: Emoji<'_, '_> = Emoji("", "");
pub static WARN_ICON: Emoji<'_, '_> = Emoji("", "");
pub static ERROR_ICON: Emoji<'_, '_> = Emoji("", "");
pub static GEAR: Emoji<'_, '_> = Emoji("", "");
pub static SPARKLE: Emoji<'_, '_> = Emoji("", "");

// ── Box-drawing constants ──────────────────────────────────────────────────
const BOX_WIDTH: usize = 72;
const BOX_H: &str = "─";
const BOX_V: &str = "│";
const BOX_BL: &str = "└";
const BOX_DIAMOND: &str = "◇";

// ── Simple message helpers ─────────────────────────────────────────────────

pub fn print_success(msg: &str) {
    println!("{} {}", SUCCESS_ICON, style(msg).green());
}

pub fn print_info(msg: &str) {
    println!("{} {}", INFO_ICON, style(msg).blue());
}

pub fn print_warn(msg: &str) {
    println!("{} {}", WARN_ICON, style(msg).yellow());
}

pub fn print_error(msg: &str) {
    eprintln!("{} {}", ERROR_ICON, style(msg).red().bold());
}

pub fn print_step(step: &str) {
    println!("{} {}", SPARKLE, style(step).bold());
}

// ── Bordered message helpers (for use inside guide sections) ──────────────

#[allow(dead_code)]
pub fn bordered_success(msg: &str) {
    println!(
        " {}  {} {}",
        style(BOX_V).dim(),
        SUCCESS_ICON,
        style(msg).green()
    );
}

pub fn bordered_info(msg: &str) {
    println!(
        " {}  {} {}",
        style(BOX_V).dim(),
        INFO_ICON,
        style(msg).blue()
    );
}

#[allow(dead_code)]
pub fn bordered_warn(msg: &str) {
    println!(
        " {}  {} {}",
        style(BOX_V).dim(),
        WARN_ICON,
        style(msg).yellow()
    );
}

#[allow(dead_code)]
pub fn bordered_error(msg: &str) {
    eprintln!(
        " {}  {} {}",
        style(BOX_V).dim(),
        ERROR_ICON,
        style(msg).red().bold()
    );
}

pub fn bordered_step(step: &str) {
    println!(
        " {}  {} {}",
        style(BOX_V).dim(),
        SPARKLE,
        style(step).bold()
    );
}

#[allow(dead_code)]
pub fn bordered_bullet(text: &str) {
    println!(" {}   {} {}", style(BOX_V).dim(), style("-").dim(), text);
}

// ── Section & layout helpers ───────────────────────────────────────────────

/// Print a bullet point.
pub fn print_bullet(text: &str) {
    println!("   {} {}", style("-").dim(), text);
}

/// Print a `│` continuation bar (for use between open() and close_section()).
pub fn guide_bar() {
    println!(" {}", style(BOX_V).dim());
}

/// Print the bottom border of a guide section: └──────────
pub fn close_section() {
    let bar = BOX_H.repeat(BOX_WIDTH);
    println!(" {}{}", style(BOX_BL).dim(), style(&bar).dim());
}

// ── Inquire render config with guide borders ──────────────────────────────

/// Threshold above which pasted content is shown as a placeholder to avoid
/// terminal display overflow and overlapping with subsequent prompts.
const LARGE_INPUT_DISPLAY_THRESHOLD: usize = 120;

/// Formatter for inquire Text prompts that may receive pasted content.
/// When the answer exceeds the threshold, shows `[Pasted content - N chars]`
/// instead of raw text to keep the terminal display clean.
pub fn large_input_formatter(s: &str) -> String {
    if s.len() > LARGE_INPUT_DISPLAY_THRESHOLD {
        format!("[Pasted content - {} chars]", s.len())
    } else {
        s.to_string()
    }
}

/// Returns an `inquire::ui::RenderConfig` whose prompt prefix and answered
/// prefix are `│` so that interactive inputs render inside a guide section.
pub fn bordered_render_config<'a>() -> inquire::ui::RenderConfig<'a> {
    inquire::ui::RenderConfig::default_colored()
        .with_prompt_prefix(inquire::ui::Styled::new(" │ ").with_fg(inquire::ui::Color::DarkGrey))
        .with_answered_prompt_prefix(
            inquire::ui::Styled::new(" │ ").with_fg(inquire::ui::Color::DarkGrey),
        )
}

// ── Boxed guide section ────────────────────────────────────────────────────

/// A builder for rendering a bordered section like:
/// ```text
/// ◇ Title ──────────────────────────────────────
/// │
/// │  Content lines go here.
/// │  More content.
/// │
/// └─────────────────────────────────────────────
/// ```
///
/// Use `print()` for self-contained sections.
/// Use `open()` to render header+content without closing, then call
/// `guide_bar()` / `close_section()` around inputs.
pub struct GuideSection {
    title: String,
    lines: Vec<GuideLine>,
}

#[allow(dead_code)]
enum GuideLine {
    Text(String),
    Blank,
    Numbered(usize, String),
    Bullet(String),
    Hint(String, String),
    Success(String),
    Info(String),
    Warn(String),
    Command(String, String),
    Status(String, String),
}

#[allow(dead_code)]
impl GuideSection {
    pub fn new(title: &str) -> Self {
        Self {
            title: title.to_string(),
            lines: Vec::new(),
        }
    }

    pub fn text(mut self, text: &str) -> Self {
        self.lines.push(GuideLine::Text(text.to_string()));
        self
    }

    pub fn blank(mut self) -> Self {
        self.lines.push(GuideLine::Blank);
        self
    }

    pub fn numbered(mut self, n: usize, text: &str) -> Self {
        self.lines.push(GuideLine::Numbered(n, text.to_string()));
        self
    }

    pub fn bullet(mut self, text: &str) -> Self {
        self.lines.push(GuideLine::Bullet(text.to_string()));
        self
    }

    pub fn hint(mut self, cmd: &str, comment: &str) -> Self {
        self.lines
            .push(GuideLine::Hint(cmd.to_string(), comment.to_string()));
        self
    }

    pub fn success(mut self, text: &str) -> Self {
        self.lines.push(GuideLine::Success(text.to_string()));
        self
    }

    pub fn info(mut self, text: &str) -> Self {
        self.lines.push(GuideLine::Info(text.to_string()));
        self
    }

    pub fn warn(mut self, text: &str) -> Self {
        self.lines.push(GuideLine::Warn(text.to_string()));
        self
    }

    pub fn command(mut self, cmd: &str, desc: &str) -> Self {
        self.lines
            .push(GuideLine::Command(cmd.to_string(), desc.to_string()));
        self
    }

    pub fn status(mut self, label: &str, value: &str) -> Self {
        self.lines
            .push(GuideLine::Status(label.to_string(), value.to_string()));
        self
    }

    /// Render the full bordered section (header + content + bottom border).
    pub fn print(&self) {
        self.render_header_and_content();
        // Empty line before bottom
        guide_bar();
        // Bottom border
        close_section();
    }

    /// Render header + content but leave the section open (no bottom border).
    /// Call `guide_bar()` for continuation lines, then `close_section()` when done.
    pub fn open(&self) {
        self.render_header_and_content();
        guide_bar();
    }

    fn render_header_and_content(&self) {
        let v = style(BOX_V).dim();

        // Top border: ◇ Title ──────────────────────────────────────
        let title_display = format!(" {} ", self.title);
        let title_width = console::measure_text_width(&title_display);
        let remaining = if BOX_WIDTH > title_width + 3 {
            BOX_WIDTH - title_width - 3
        } else {
            4
        };
        println!();
        println!(
            " {} {}{}",
            style(BOX_DIAMOND).cyan(),
            style(&title_display).bold(),
            style(BOX_H.repeat(remaining)).dim(),
        );

        // Empty line after title
        println!(" {}", v);

        // Content lines
        for line in &self.lines {
            match line {
                GuideLine::Blank => {
                    println!(" {}", v);
                }
                GuideLine::Text(t) => {
                    println!(" {}  {}", v, style(t).dim());
                }
                GuideLine::Numbered(n, t) => {
                    println!(" {}  {}. {}", v, style(n).cyan().bold(), t);
                }
                GuideLine::Bullet(t) => {
                    println!(" {}  {} {}", v, style("-").dim(), t);
                }
                GuideLine::Hint(cmd, comment) => {
                    if comment.is_empty() {
                        println!(" {}  {} {}", v, style("$").dim(), style(cmd).cyan());
                    } else {
                        println!(
                            " {}  {} {:<28} {}",
                            v,
                            style("$").dim(),
                            style(cmd).cyan(),
                            style(comment).dim()
                        );
                    }
                }
                GuideLine::Success(t) => {
                    println!(" {}  {} {}", v, SUCCESS_ICON, style(t).green());
                }
                GuideLine::Info(t) => {
                    println!(" {}  {} {}", v, INFO_ICON, style(t).blue());
                }
                GuideLine::Warn(t) => {
                    println!(" {}  {} {}", v, WARN_ICON, style(t).yellow());
                }
                GuideLine::Command(cmd, desc) => {
                    println!(
                        " {}  {} {:<14} {}",
                        v,
                        style("▶").cyan(),
                        style(cmd).white(),
                        style(desc).dim()
                    );
                }
                GuideLine::Status(label, value) => {
                    println!(" {}  {} {}: {}", v, GEAR, style(label).bold().cyan(), value);
                }
            }
        }
    }
}

// ── Banner ─────────────────────────────────────────────────────────────────

pub fn print_banner() {
    let lines: &[&str] = &[
        "                                 ",
        " _ __ ___   _____  ___  ___   _  ",
        "| '_ ` _ \\ / _ \\ \\/ / \\/ / | | |",
        "| | | | | | (_) >  < >  <| |_| |",
        "|_| |_| |_|\\___/_/\\_/_/\\_\\\\__, |",
        "                           |___/ ",
    ];

    // Gradient: #818cf8 → #a78bfa → #22d3ee (diagonal top-left → bottom-right)
    let stops: [(u8, u8, u8); 3] = [(129, 140, 248), (167, 139, 250), (34, 211, 238)];
    let max_w = 33u32;
    let max_d = max_w + 5 * 10;

    println!();

    for (y, line) in lines.iter().enumerate() {
        print!("  ");
        for (x, ch) in line.chars().enumerate() {
            if ch == ' ' {
                print!(" ");
                continue;
            }
            let d = ((x as u32 + y as u32 * 10) * 1000 / max_d).min(1000);
            let (r, g, b) = if d <= 500 {
                let t = d * 2;
                lerp_color(stops[0], stops[1], t)
            } else {
                let t = (d - 500) * 2;
                lerp_color(stops[1], stops[2], t)
            };
            print!("\x1b[38;2;{};{};{}m{}", r, g, b, ch);
        }
        println!("\x1b[0m");
    }

    println!(" \x1b[38;2;34;211;238m Agents that think while you sleep.\x1b[0m");
    println!();
}

fn lerp_color(a: (u8, u8, u8), b: (u8, u8, u8), t: u32) -> (u8, u8, u8) {
    let r = (a.0 as u32 * (1000 - t) + b.0 as u32 * t) / 1000;
    let g = (a.1 as u32 * (1000 - t) + b.1 as u32 * t) / 1000;
    let b_val = (a.2 as u32 * (1000 - t) + b.2 as u32 * t) / 1000;
    (r as u8, g as u8, b_val as u8)
}

pub fn print_goodbye() {
    println!(
        "\n{} {}",
        SPARKLE,
        style("Thank you for using moxxy. See you next time!")
            .bold()
            .cyan()
    );
}
