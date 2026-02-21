use std::path::Path;
use std::process::Command;

fn main() {
    let frontend_dist = Path::new("frontend/dist");

    if !frontend_dist.exists() {
        eprintln!("frontend/dist not found, building frontend...");

        let npm_install = Command::new("npm")
            .args(["ci", "--prefer-offline"])
            .current_dir("frontend")
            .status()
            .or_else(|_| {
                Command::new("npm")
                    .args(["install"])
                    .current_dir("frontend")
                    .status()
            })
            .expect("Failed to run npm install - is Node.js installed?");

        if !npm_install.success() {
            panic!("npm install failed");
        }

        let npm_build = Command::new("npm")
            .args(["run", "build"])
            .current_dir("frontend")
            .status()
            .expect("Failed to run npm run build");

        if !npm_build.success() {
            panic!("Frontend build failed");
        }
    }

    println!("cargo::rerun-if-changed=frontend/dist");
}
