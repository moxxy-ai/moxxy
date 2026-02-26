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

const SKILLS_REQUIRING_CONFIRMATION: &[&str] = &["evolve_core"];

#[test]
fn evolve_core_manifest_requires_confirmation() {
    let manifest_path = builtins_dir().join("evolve_core").join("manifest.toml");
    let raw = std::fs::read_to_string(&manifest_path).expect("manifest should be readable");
    let value: toml::Value = toml::from_str(&raw).expect("manifest should parse");

    let needs_confirmation = value
        .get("needs_confirmation")
        .and_then(toml::Value::as_bool)
        .unwrap_or(false);
    assert!(
        needs_confirmation,
        "evolve_core must have needs_confirmation = true"
    );
}

#[test]
fn needs_confirmation_only_set_on_expected_skills() {
    let dir = builtins_dir();
    let expected: HashSet<&str> = SKILLS_REQUIRING_CONFIRMATION.iter().copied().collect();

    for entry in std::fs::read_dir(&dir).expect("builtins dir should be readable") {
        let entry = entry.expect("dir entry");
        if !entry.path().is_dir() {
            continue;
        }
        let skill_name = entry.file_name().to_string_lossy().to_string();
        let manifest_path = entry.path().join("manifest.toml");
        if !manifest_path.exists() {
            continue;
        }

        let raw = std::fs::read_to_string(&manifest_path).expect("manifest should be readable");
        let value: toml::Value = toml::from_str(&raw).expect("manifest should parse");

        let needs_confirmation = value
            .get("needs_confirmation")
            .and_then(toml::Value::as_bool)
            .unwrap_or(false);

        if expected.contains(skill_name.as_str()) {
            assert!(
                needs_confirmation,
                "Skill {} should have needs_confirmation = true",
                skill_name
            );
        } else {
            assert!(
                !needs_confirmation,
                "Skill {} should NOT have needs_confirmation = true (not in allowlist)",
                skill_name
            );
        }
    }
}

#[test]
fn evolve_core_docs_do_not_reference_dev_mode() {
    let skill_md = builtins_dir().join("evolve_core").join("skill.md");
    let content = std::fs::read_to_string(&skill_md).expect("skill.md should be readable");
    let lower = content.to_lowercase();
    assert!(
        !lower.contains("dev mode"),
        "evolve_core skill.md should not reference dev mode"
    );

    let manifest = builtins_dir().join("evolve_core").join("manifest.toml");
    let manifest_content = std::fs::read_to_string(&manifest).expect("manifest should be readable");
    let manifest_lower = manifest_content.to_lowercase();
    assert!(
        !manifest_lower.contains("dev mode"),
        "evolve_core manifest.toml should not reference dev mode"
    );
}

#[test]
fn needs_confirmation_defaults_to_false_when_absent() {
    let toml_str = r#"
name = "test_skill"
description = "A test skill"
version = "1.0.0"
"#;
    let value: toml::Value = toml::from_str(toml_str).expect("should parse");
    let needs_confirmation = value
        .get("needs_confirmation")
        .and_then(toml::Value::as_bool)
        .unwrap_or(false);
    assert!(
        !needs_confirmation,
        "needs_confirmation should default to false when absent"
    );
}

#[test]
#[cfg_attr(windows, ignore = "run.sh syntax check not applicable on Windows (skills use run.ps1)")]
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
