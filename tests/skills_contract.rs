use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

const EXPECTED_SKILLS: &[&str] = &[
    "browser",
    "computer_control",
    "delegate_task",
    "discord_channels",
    "discord_notify",
    "evolve_core",
    "example_skill",
    "file_ops",
    "git",
    "github",
    "google_workspace",
    "host_python",
    "host_shell",
    "manage_providers",
    "manage_vault",
    "mcp",
    "modify_schedule",
    "openclaw_migrate",
    "osx_email",
    "remove_schedule",
    "scheduler",
    "skill",
    "telegram_notify",
    "webhook",
    "whatsapp_notify",
    "workspace_shell",
];

fn builtins_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("skills")
        .join("builtins")
}

fn manifest_run_command(manifest_path: &Path) -> String {
    let raw = std::fs::read_to_string(manifest_path).expect("manifest should be readable");
    let value: toml::Value = toml::from_str(&raw).expect("manifest should parse as toml");
    value
        .get("run_command")
        .and_then(toml::Value::as_str)
        .unwrap_or("sh")
        .to_string()
}

#[test]
fn builtin_skill_catalog_contains_all_expected_skills() {
    let dir = builtins_dir();
    let mut actual = HashSet::new();
    for entry in std::fs::read_dir(&dir).expect("builtins dir should be readable") {
        let entry = entry.expect("dir entry");
        if entry.path().is_dir() {
            actual.insert(entry.file_name().to_string_lossy().to_string());
        }
    }

    let expected: HashSet<String> = EXPECTED_SKILLS.iter().map(|s| s.to_string()).collect();
    let missing: Vec<_> = expected.difference(&actual).collect();
    assert!(
        missing.is_empty(),
        "Missing expected skill directories: {:?}",
        missing
    );
    assert!(
        actual.len() >= expected.len(),
        "Expected at least {} builtin skill directories, found {}",
        expected.len(),
        actual.len()
    );
}

#[test]
fn every_builtin_skill_has_manifest_run_and_docs() {
    for skill in EXPECTED_SKILLS {
        let skill_dir = builtins_dir().join(skill);
        assert!(
            skill_dir.is_dir(),
            "missing skill directory: {}",
            skill_dir.display()
        );
        assert!(
            skill_dir.join("manifest.toml").is_file(),
            "missing manifest.toml for skill {}",
            skill
        );
        assert!(
            skill_dir.join("run.sh").is_file(),
            "missing run.sh for skill {}",
            skill
        );
        assert!(
            skill_dir.join("skill.md").is_file(),
            "missing skill.md for skill {}",
            skill
        );
    }
}

#[test]
fn every_builtin_manifest_parses_and_has_required_fields() {
    for skill in EXPECTED_SKILLS {
        let manifest_path = builtins_dir().join(skill).join("manifest.toml");
        let raw = std::fs::read_to_string(&manifest_path).expect("manifest should be readable");
        let value: toml::Value = toml::from_str(&raw).expect("manifest should parse");

        let name = value
            .get("name")
            .and_then(toml::Value::as_str)
            .unwrap_or_default();
        let description = value
            .get("description")
            .and_then(toml::Value::as_str)
            .unwrap_or_default();
        let version = value
            .get("version")
            .and_then(toml::Value::as_str)
            .unwrap_or_default();

        assert!(!name.is_empty(), "manifest name missing for {}", skill);
        assert!(
            !description.is_empty(),
            "manifest description missing for {}",
            skill
        );
        assert!(
            !version.is_empty(),
            "manifest version missing for {}",
            skill
        );
    }
}

#[test]
fn every_builtin_run_script_passes_shell_syntax_check() {
    for skill in EXPECTED_SKILLS {
        let skill_dir = builtins_dir().join(skill);
        let manifest_path = skill_dir.join("manifest.toml");
        let run_path = skill_dir.join("run.sh");
        let run_command = manifest_run_command(&manifest_path).to_lowercase();
        let shell = if run_command.contains("bash") {
            "bash"
        } else {
            "sh"
        };

        if Command::new(shell).arg("--version").output().is_err() {
            eprintln!(
                "Skipping {} shell syntax check for {}, shell unavailable",
                shell, skill
            );
            continue;
        }

        let output = Command::new(shell)
            .arg("-n")
            .arg(&run_path)
            .output()
            .expect("shell check command should execute");
        assert!(
            output.status.success(),
            "shell syntax check failed for {} with {}: {}",
            skill,
            shell,
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
