use std::path::PathBuf;

pub struct MemoryRecord {
    pub path: String,
    pub timestamp: String,
    pub tags: Vec<String>,
}

pub struct MemoryJournal {
    base_dir: PathBuf,
}

impl MemoryJournal {
    pub fn new(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    pub fn append(&self, content: &str, tags: &[&str]) -> Result<MemoryRecord, std::io::Error> {
        std::fs::create_dir_all(&self.base_dir)?;
        let now = chrono::Utc::now();
        let filename = format!("{}.md", now.format("%Y%m%d_%H%M%S_%3f"));
        let path = self.base_dir.join(&filename);

        let mut markdown = String::new();
        markdown.push_str(&format!("---\ntimestamp: {}\n", now.to_rfc3339()));
        if !tags.is_empty() {
            markdown.push_str(&format!("tags: [{}]\n", tags.join(", ")));
        }
        markdown.push_str("---\n\n");
        markdown.push_str(content);
        markdown.push('\n');

        std::fs::write(&path, &markdown)?;

        Ok(MemoryRecord {
            path: path.to_string_lossy().to_string(),
            timestamp: now.to_rfc3339(),
            tags: tags.iter().map(|s| s.to_string()).collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn append_creates_markdown_file() {
        let tmp = TempDir::new().unwrap();
        let journal = MemoryJournal::new(tmp.path().to_path_buf());
        let record = journal.append("Test memory entry", &["tag1", "tag2"]).unwrap();
        assert!(std::path::Path::new(&record.path).exists());
        let content = std::fs::read_to_string(&record.path).unwrap();
        assert!(content.contains("Test memory entry"));
    }

    #[test]
    fn append_returns_record_with_path_and_timestamp() {
        let tmp = TempDir::new().unwrap();
        let journal = MemoryJournal::new(tmp.path().to_path_buf());
        let record = journal.append("Entry", &[]).unwrap();
        assert!(!record.path.is_empty());
        assert!(!record.timestamp.is_empty());
    }

    #[test]
    fn append_creates_directory_if_missing() {
        let tmp = TempDir::new().unwrap();
        let nested = tmp.path().join("deep").join("nested").join("memory");
        let journal = MemoryJournal::new(nested.clone());
        let record = journal.append("Entry", &[]).unwrap();
        assert!(nested.exists());
        assert!(std::path::Path::new(&record.path).exists());
    }

    #[test]
    fn multiple_appends_create_distinct_files() {
        let tmp = TempDir::new().unwrap();
        let journal = MemoryJournal::new(tmp.path().to_path_buf());
        let r1 = journal.append("First", &[]).unwrap();
        // Sleep briefly to ensure distinct timestamps
        std::thread::sleep(std::time::Duration::from_millis(2));
        let r2 = journal.append("Second", &[]).unwrap();
        assert_ne!(r1.path, r2.path);
    }
}
