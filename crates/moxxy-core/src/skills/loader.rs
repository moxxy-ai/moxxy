use std::path::{Path, PathBuf};

use super::doc::SkillDoc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillSource {
    Builtin,
    Agent,
}

#[derive(Debug)]
pub struct LoadedSkill {
    pub doc: SkillDoc,
    pub path: PathBuf,
    pub source: SkillSource,
}

pub struct SkillLoader;

impl SkillLoader {
    /// Load built-in skills from `{moxxy_home}/skills/*/SKILL.md`.
    pub fn load_builtin(moxxy_home: &Path) -> Vec<LoadedSkill> {
        Self::load_from_dir(&moxxy_home.join("skills"), SkillSource::Builtin)
    }

    /// Load agent-specific skills from `{agent_dir}/skills/*/SKILL.md`.
    pub fn load_agent(agent_dir: &Path) -> Vec<LoadedSkill> {
        Self::load_from_dir(&agent_dir.join("skills"), SkillSource::Agent)
    }

    /// Load all skills, merging built-in and agent skills.
    /// Agent skills override built-in skills with the same slug.
    pub fn load_all(moxxy_home: &Path, agent_dir: &Path) -> Vec<LoadedSkill> {
        let mut builtin = Self::load_builtin(moxxy_home);
        let agent = Self::load_agent(agent_dir);

        // Remove builtins that are overridden by agent skills (matched by slug)
        let agent_slugs: Vec<String> = agent.iter().map(|s| s.doc.slug()).collect();
        builtin.retain(|s| !agent_slugs.contains(&s.doc.slug()));

        builtin.extend(agent);
        builtin
    }

    fn load_from_dir(skills_dir: &Path, source: SkillSource) -> Vec<LoadedSkill> {
        let entries = match std::fs::read_dir(skills_dir) {
            Ok(entries) => entries,
            Err(_) => return Vec::new(),
        };

        let mut skills = Vec::new();
        for entry in entries.flatten() {
            let skill_md = entry.path().join("SKILL.md");
            if skill_md.is_file() {
                match SkillDoc::load_from_file(&skill_md) {
                    Ok(doc) => {
                        skills.push(LoadedSkill {
                            doc,
                            path: skill_md,
                            source,
                        });
                    }
                    Err(e) => {
                        tracing::warn!(
                            path = %skill_md.display(),
                            error = %e,
                            "Skipping invalid skill file"
                        );
                    }
                }
            }
        }
        skills
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn valid_skill_content(name: &str) -> String {
        format!(
            "---\nname: {name}\ndescription: A skill called {name}\nauthor: tester\nversion: \"1.0\"\n---\n# {name}\nBody"
        )
    }

    fn write_skill(dir: &Path, slug: &str, content: &str) {
        let skill_dir = dir.join("skills").join(slug);
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), content).unwrap();
    }

    #[test]
    fn load_builtin_returns_skills_from_skills_dir() {
        let tmp = TempDir::new().unwrap();
        let moxxy_home = tmp.path();
        write_skill(moxxy_home, "my-builtin", &valid_skill_content("my-builtin"));

        let skills = SkillLoader::load_builtin(moxxy_home);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].doc.name, "my-builtin");
        assert_eq!(skills[0].source, SkillSource::Builtin);
    }

    #[test]
    fn load_agent_returns_skills_from_agent_skills_dir() {
        let tmp = TempDir::new().unwrap();
        let agent_dir = tmp.path();
        write_skill(
            agent_dir,
            "my-agent-skill",
            &valid_skill_content("my-agent-skill"),
        );

        let skills = SkillLoader::load_agent(agent_dir);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].doc.name, "my-agent-skill");
        assert_eq!(skills[0].source, SkillSource::Agent);
    }

    #[test]
    fn load_all_merges_builtin_and_agent() {
        let home = TempDir::new().unwrap();
        let agent = TempDir::new().unwrap();
        write_skill(home.path(), "builtin-1", &valid_skill_content("builtin-1"));
        write_skill(agent.path(), "agent-1", &valid_skill_content("agent-1"));

        let skills = SkillLoader::load_all(home.path(), agent.path());
        assert_eq!(skills.len(), 2);
        let names: Vec<&str> = skills.iter().map(|s| s.doc.name.as_str()).collect();
        assert!(names.contains(&"builtin-1"));
        assert!(names.contains(&"agent-1"));
    }

    #[test]
    fn load_all_agent_overrides_builtin_with_same_slug() {
        let home = TempDir::new().unwrap();
        let agent = TempDir::new().unwrap();
        write_skill(home.path(), "shared", &valid_skill_content("shared"));
        write_skill(agent.path(), "shared", &valid_skill_content("shared"));

        let skills = SkillLoader::load_all(home.path(), agent.path());
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].source, SkillSource::Agent);
    }

    #[test]
    fn load_from_empty_dir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let skills = SkillLoader::load_builtin(tmp.path());
        assert!(skills.is_empty());
    }

    #[test]
    fn load_skips_invalid_skill_files() {
        let tmp = TempDir::new().unwrap();
        // Write an invalid SKILL.md (no frontmatter)
        let skill_dir = tmp.path().join("skills").join("bad-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "no frontmatter").unwrap();
        // Write a valid one
        write_skill(tmp.path(), "good-skill", &valid_skill_content("good-skill"));

        let skills = SkillLoader::load_builtin(tmp.path());
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].doc.name, "good-skill");
    }
}
