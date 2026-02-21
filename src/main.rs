mod core;
mod interfaces;
mod skills;
mod cli;
mod logging;

use crate::core::terminal;

#[tokio::main]
async fn main() {
    if let Err(e) = cli::run_main().await {
        let err_msg = e.to_string();
        if err_msg.contains("canceled") || err_msg.contains("OperationCanceled") {
            terminal::print_goodbye();
        } else {
            terminal::print_error(&format!("{}", e));
            std::process::exit(1);
        }
    } else {
        terminal::print_goodbye();
    }
}
