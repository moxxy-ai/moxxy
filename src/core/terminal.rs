use console::{style, Emoji};

pub static LOOKING_GLASS: Emoji<'_, '_> = Emoji("🔍 ", "");
pub static SUCCESS_ICON: Emoji<'_, '_> = Emoji("✅ ", "");
pub static INFO_ICON: Emoji<'_, '_> = Emoji("ℹ️  ", "");
pub static WARN_ICON: Emoji<'_, '_> = Emoji("⚠️  ", "");
pub static ERROR_ICON: Emoji<'_, '_> = Emoji("❌ ", "");
pub static ROCKET: Emoji<'_, '_> = Emoji("🚀 ", "");
pub static GLOBE: Emoji<'_, '_> = Emoji("🌐 ", "");
pub static GEAR: Emoji<'_, '_> = Emoji("⚙️  ", "");
pub static SPARKLE: Emoji<'_, '_> = Emoji("✨ ", "");

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

pub fn print_status(label: &str, msg: &str) {
    println!("  {} {}: {}", GEAR, style(label).bold().cyan(), msg);
}

pub fn print_step(step: &str) {
    println!("{} {}", SPARKLE, style(step).bold());
}

pub fn print_link(label: &str, url: &str) {
    println!(
        "  {} {}: {}",
        GLOBE,
        style(label).bold(),
        style(url).underlined().cyan()
    );
}

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
        println!();
    }
    print!("\x1b[0m");

    println!("\x1b[38;2;34;211;238mAgents that think while you sleep.\x1b[0m\n");
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
