use std::path::{Path, PathBuf};

use fs2::FileExt;
use moxxy_types::HeartbeatError;
use serde::{Deserialize, Serialize};

use super::HeartbeatRule;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HeartbeatEntry {
    pub id: String,
    pub action_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_payload: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_minutes: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_expr: Option<String>,
    pub timezone: String,
    pub enabled: bool,
    pub next_run_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HeartbeatFrontmatter {
    pub heartbeats: Vec<HeartbeatEntry>,
}

#[derive(Debug)]
pub struct HeartbeatFile {
    pub entries: Vec<HeartbeatEntry>,
    pub notes: String,
}

impl From<&HeartbeatEntry> for HeartbeatRule {
    fn from(e: &HeartbeatEntry) -> Self {
        HeartbeatRule {
            id: e.id.clone(),
            interval_minutes: e.interval_minutes.unwrap_or(1),
            enabled: e.enabled,
            next_run_at: e.next_run_at.clone(),
            cron_expr: e.cron_expr.clone(),
            timezone: e.timezone.clone(),
        }
    }
}

pub fn heartbeat_path(moxxy_home: &Path, agent_id: &str) -> PathBuf {
    moxxy_home
        .join("agents")
        .join(agent_id)
        .join("heartbeat.md")
}

pub fn read_heartbeat_file(path: &Path) -> Result<HeartbeatFile, HeartbeatError> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(HeartbeatFile {
                entries: vec![],
                notes: String::new(),
            });
        }
        Err(e) => return Err(HeartbeatError::FileIo(e.to_string())),
    };

    if content.trim().is_empty() {
        return Ok(HeartbeatFile {
            entries: vec![],
            notes: String::new(),
        });
    }

    parse_heartbeat_content(&content)
}

fn parse_heartbeat_content(content: &str) -> Result<HeartbeatFile, HeartbeatError> {
    // Check for YAML frontmatter delimiters
    if !content.starts_with("---\n") && !content.starts_with("---\r\n") {
        // No frontmatter - treat entire content as notes
        return Ok(HeartbeatFile {
            entries: vec![],
            notes: content.to_string(),
        });
    }

    // Find the closing delimiter
    let after_open = &content[4..]; // skip "---\n"
    let close_pos = after_open
        .find("\n---\n")
        .or_else(|| after_open.find("\n---\r\n"))
        .or_else(|| {
            // Handle case where closing --- is at end of file with no trailing newline after it
            if after_open.ends_with("\n---") {
                Some(after_open.len() - 3)
            } else {
                None
            }
        });

    let (yaml_str, notes) = match close_pos {
        Some(pos) => {
            let yaml = &after_open[..pos];
            let rest_start = pos + 1; // skip the \n before ---
            let rest = &after_open[rest_start..];
            // Skip the closing "---" and any trailing newline
            let notes = rest
                .strip_prefix("---\n")
                .or_else(|| rest.strip_prefix("---\r\n"))
                .or_else(|| rest.strip_prefix("---"))
                .unwrap_or(rest);
            (yaml, notes.to_string())
        }
        None => {
            // No closing delimiter - treat everything after opening as YAML
            (after_open, String::new())
        }
    };

    let frontmatter: HeartbeatFrontmatter =
        serde_yaml::from_str(yaml_str).map_err(|e| HeartbeatError::ParseError(e.to_string()))?;

    Ok(HeartbeatFile {
        entries: frontmatter.heartbeats,
        notes,
    })
}

pub fn write_heartbeat_file(path: &Path, file: &HeartbeatFile) -> Result<(), HeartbeatError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| HeartbeatError::FileIo(e.to_string()))?;
    }

    let frontmatter = HeartbeatFrontmatter {
        heartbeats: file.entries.clone(),
    };
    let yaml = serde_yaml::to_string(&frontmatter)
        .map_err(|e| HeartbeatError::ParseError(e.to_string()))?;

    let mut content = String::new();
    content.push_str("---\n");
    content.push_str(&yaml);
    content.push_str("---\n");
    if !file.notes.is_empty() {
        content.push('\n');
        content.push_str(&file.notes);
        if !file.notes.ends_with('\n') {
            content.push('\n');
        }
    }

    std::fs::write(path, content).map_err(|e| HeartbeatError::FileIo(e.to_string()))?;
    Ok(())
}

pub fn mutate_heartbeat_file<F>(path: &Path, mutator: F) -> Result<HeartbeatFile, HeartbeatError>
where
    F: FnOnce(&mut HeartbeatFile),
{
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| HeartbeatError::FileIo(e.to_string()))?;
    }

    // Open or create a lock file alongside the heartbeat file
    let lock_path = path.with_extension("md.lock");
    let lock_file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&lock_path)
        .map_err(|e| HeartbeatError::FileIo(format!("lock file: {e}")))?;

    lock_file
        .lock_exclusive()
        .map_err(|e| HeartbeatError::FileIo(format!("file lock: {e}")))?;

    let mut file = read_heartbeat_file(path)?;
    mutator(&mut file);
    write_heartbeat_file(path, &file)?;

    lock_file
        .unlock()
        .map_err(|e| HeartbeatError::FileIo(format!("file unlock: {e}")))?;

    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_missing_file_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("heartbeat.md");
        let file = read_heartbeat_file(&path).unwrap();
        assert!(file.entries.is_empty());
        assert!(file.notes.is_empty());
    }

    #[test]
    fn read_empty_file_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("heartbeat.md");
        std::fs::write(&path, "").unwrap();
        let file = read_heartbeat_file(&path).unwrap();
        assert!(file.entries.is_empty());
        assert!(file.notes.is_empty());
    }

    #[test]
    fn roundtrip_single_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("heartbeat.md");

        let entry = HeartbeatEntry {
            id: "abc-123".into(),
            action_type: "execute_skill".into(),
            action_payload: Some("Run daily report".into()),
            interval_minutes: Some(60),
            cron_expr: None,
            timezone: "UTC".into(),
            enabled: true,
            next_run_at: "2026-03-03T12:00:00Z".into(),
            created_at: "2026-03-01T10:00:00Z".into(),
            updated_at: "2026-03-01T10:00:00Z".into(),
        };

        let original = HeartbeatFile {
            entries: vec![entry.clone()],
            notes: String::new(),
        };

        write_heartbeat_file(&path, &original).unwrap();
        let loaded = read_heartbeat_file(&path).unwrap();
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.entries[0], entry);
    }

    #[test]
    fn roundtrip_multiple_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("heartbeat.md");

        let e1 = HeartbeatEntry {
            id: "abc-123".into(),
            action_type: "execute_skill".into(),
            action_payload: Some("Run daily report".into()),
            interval_minutes: Some(60),
            cron_expr: None,
            timezone: "UTC".into(),
            enabled: true,
            next_run_at: "2026-03-03T12:00:00Z".into(),
            created_at: "2026-03-01T10:00:00Z".into(),
            updated_at: "2026-03-01T10:00:00Z".into(),
        };

        let e2 = HeartbeatEntry {
            id: "def-456".into(),
            action_type: "notify_cli".into(),
            action_payload: None,
            interval_minutes: None,
            cron_expr: Some("0 0 9 * * *".into()),
            timezone: "Europe/Warsaw".into(),
            enabled: true,
            next_run_at: "2026-03-04T08:00:00Z".into(),
            created_at: "2026-03-02T15:00:00Z".into(),
            updated_at: "2026-03-02T15:00:00Z".into(),
        };

        let original = HeartbeatFile {
            entries: vec![e1.clone(), e2.clone()],
            notes: String::new(),
        };

        write_heartbeat_file(&path, &original).unwrap();
        let loaded = read_heartbeat_file(&path).unwrap();
        assert_eq!(loaded.entries.len(), 2);
        assert_eq!(loaded.entries[0], e1);
        assert_eq!(loaded.entries[1], e2);
    }

    #[test]
    fn roundtrip_preserves_notes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("heartbeat.md");

        let entry = HeartbeatEntry {
            id: "abc-123".into(),
            action_type: "notify_cli".into(),
            action_payload: None,
            interval_minutes: Some(30),
            cron_expr: None,
            timezone: "UTC".into(),
            enabled: true,
            next_run_at: "2026-03-03T12:00:00Z".into(),
            created_at: "2026-03-01T10:00:00Z".into(),
            updated_at: "2026-03-01T10:00:00Z".into(),
        };

        let original = HeartbeatFile {
            entries: vec![entry],
            notes: "Agent notes about heartbeats...\nLine 2 of notes.".into(),
        };

        write_heartbeat_file(&path, &original).unwrap();
        let loaded = read_heartbeat_file(&path).unwrap();
        assert_eq!(loaded.notes.trim(), original.notes.trim());
    }

    #[test]
    fn mutate_adds_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agents").join("a1").join("heartbeat.md");

        let new_entry = HeartbeatEntry {
            id: "new-1".into(),
            action_type: "notify_cli".into(),
            action_payload: None,
            interval_minutes: Some(10),
            cron_expr: None,
            timezone: "UTC".into(),
            enabled: true,
            next_run_at: "2026-03-03T12:00:00Z".into(),
            created_at: "2026-03-03T12:00:00Z".into(),
            updated_at: "2026-03-03T12:00:00Z".into(),
        };
        let entry_clone = new_entry.clone();

        let file = mutate_heartbeat_file(&path, |f| {
            f.entries.push(entry_clone);
        })
        .unwrap();

        assert_eq!(file.entries.len(), 1);
        assert_eq!(file.entries[0], new_entry);

        // Verify persistence
        let loaded = read_heartbeat_file(&path).unwrap();
        assert_eq!(loaded.entries.len(), 1);
    }

    #[test]
    fn mutate_removes_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("heartbeat.md");

        let entry = HeartbeatEntry {
            id: "abc-123".into(),
            action_type: "notify_cli".into(),
            action_payload: None,
            interval_minutes: Some(30),
            cron_expr: None,
            timezone: "UTC".into(),
            enabled: true,
            next_run_at: "2026-03-03T12:00:00Z".into(),
            created_at: "2026-03-01T10:00:00Z".into(),
            updated_at: "2026-03-01T10:00:00Z".into(),
        };

        let original = HeartbeatFile {
            entries: vec![entry],
            notes: String::new(),
        };
        write_heartbeat_file(&path, &original).unwrap();

        let file = mutate_heartbeat_file(&path, |f| {
            f.entries.retain(|e| e.id != "abc-123");
        })
        .unwrap();

        assert!(file.entries.is_empty());
    }

    #[test]
    fn mutate_updates_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("heartbeat.md");

        let entry = HeartbeatEntry {
            id: "abc-123".into(),
            action_type: "notify_cli".into(),
            action_payload: None,
            interval_minutes: Some(30),
            cron_expr: None,
            timezone: "UTC".into(),
            enabled: true,
            next_run_at: "2026-03-03T12:00:00Z".into(),
            created_at: "2026-03-01T10:00:00Z".into(),
            updated_at: "2026-03-01T10:00:00Z".into(),
        };

        let original = HeartbeatFile {
            entries: vec![entry],
            notes: String::new(),
        };
        write_heartbeat_file(&path, &original).unwrap();

        let file = mutate_heartbeat_file(&path, |f| {
            if let Some(e) = f.entries.iter_mut().find(|e| e.id == "abc-123") {
                e.enabled = false;
                e.updated_at = "2026-03-03T13:00:00Z".into();
            }
        })
        .unwrap();

        assert_eq!(file.entries.len(), 1);
        assert!(!file.entries[0].enabled);
        assert_eq!(file.entries[0].updated_at, "2026-03-03T13:00:00Z");
    }

    #[test]
    fn heartbeat_rule_from_entry() {
        let entry = HeartbeatEntry {
            id: "abc-123".into(),
            action_type: "execute_skill".into(),
            action_payload: Some("task".into()),
            interval_minutes: Some(60),
            cron_expr: None,
            timezone: "UTC".into(),
            enabled: true,
            next_run_at: "2026-03-03T12:00:00Z".into(),
            created_at: "2026-03-01T10:00:00Z".into(),
            updated_at: "2026-03-01T10:00:00Z".into(),
        };

        let rule = HeartbeatRule::from(&entry);
        assert_eq!(rule.id, "abc-123");
        assert_eq!(rule.interval_minutes, 60);
        assert!(rule.enabled);
        assert_eq!(rule.next_run_at, "2026-03-03T12:00:00Z");
        assert!(rule.cron_expr.is_none());
    }
}
