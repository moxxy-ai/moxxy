use axum::{
    Json,
    extract::{Path, State},
};
use tracing::info;

use super::super::AppState;

#[derive(serde::Deserialize)]
pub struct CreateSkillRequest {
    name: String,
    description: String,
    /// Platform targeting: `None` or `"all"` = generate both run.sh and run.ps1 (cross-platform).
    /// `"windows"` = run.ps1 only. `"macos"` or `"linux"` = run.sh only.
    #[serde(default)]
    platform: Option<String>,
}

pub async fn create_skill_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<CreateSkillRequest>,
) -> Json<serde_json::Value> {
    use crate::core::llm::ChatMessage;
    use crate::skills::SkillManifest;

    // 1. Get the agent's LlmManager
    let llm_reg = state.llm_registry.lock().await;
    let llm_mutex = match llm_reg.get(&agent) {
        Some(m) => m.clone(),
        None => return Json(serde_json::json!({ "success": false, "error": "Agent not found" })),
    };
    drop(llm_reg);

    // 2. Determine platform targeting
    let platform_lower = payload.platform.as_ref().map(|s| s.to_lowercase());
    let platform = platform_lower.as_deref();
    let want_both = matches!(platform, None | Some("all") | Some(""));
    let want_windows_only = platform == Some("windows");
    let want_unix_only = matches!(platform, Some("macos") | Some("linux") | Some("unix"));

    // 3. Build a structured prompt based on platform
    let (prompt, expected_blocks) = if want_both {
        (
            format!(
                r#"Generate exactly 4 fenced code blocks for a new agent skill called "{name}".
Description: {desc}

Block 1 - manifest.toml (TOML):
```toml
name = "{name}"
description = "<one-line description>"
version = "1.0.0"
needs_network = <true or false>
needs_fs_read = <true or false>
needs_fs_write = <true or false>
needs_env = <true or false>
platform = "all"
```

Block 2 - skill.md (Markdown):
```markdown
# {name}
<usage docs for the agent: when to use, what args it takes ($1, $2, ...), example invocations>
```

Block 3 - run.sh (Shell):
```sh
#!/bin/sh
<real shell script that implements the skill, uses $1 $2 etc. for args>
```

Block 4 - run.ps1 (PowerShell):
```powershell
$ErrorActionPreference = "Stop"
<PowerShell script that mirrors run.sh logic, uses $args[0], $args[1] etc.>
```

Rules:
- Output ONLY these 4 fenced code blocks, nothing else.
- run.sh MUST start with #!/bin/sh and be a real executable shell script.
- run.ps1 MUST start with $ErrorActionPreference = "Stop" and mirror run.sh logic using PowerShell (ConvertTo-Json, Invoke-RestMethod).
- Use $1, $2 in run.sh and $args[0], $args[1] in run.ps1 for positional arguments.
- manifest.toml MUST be valid TOML with the exact fields shown above.
- skill.md must document what the skill does and how to invoke it."#,
                name = payload.name,
                desc = payload.description,
            ),
            4,
        )
    } else if want_windows_only {
        (
            format!(
                r#"Generate exactly 3 fenced code blocks for a new Windows-only agent skill called "{name}".
Description: {desc}

Block 1 - manifest.toml (TOML):
```toml
name = "{name}"
description = "<one-line description>"
version = "1.0.0"
needs_network = <true or false>
needs_fs_read = <true or false>
needs_fs_write = <true or false>
needs_env = <true or false>
platform = "windows"
entrypoint = "run.ps1"
run_command = "powershell"
```

Block 2 - skill.md (Markdown):
```markdown
# {name}
<usage docs for the agent: when to use, what args it takes ($args[0], $args[1], ...), example invocations>
```

Block 3 - run.ps1 (PowerShell):
```powershell
$ErrorActionPreference = "Stop"
<real PowerShell script that implements the skill, uses $args[0] $args[1] etc. for args>
```

Rules:
- Output ONLY these 3 fenced code blocks, nothing else.
- run.ps1 MUST start with $ErrorActionPreference = "Stop" and be a real PowerShell script.
- Use $args[0], $args[1], etc. for positional arguments.
- manifest.toml MUST be valid TOML with entrypoint = "run.ps1" and run_command = "powershell".
- skill.md must document what the skill does and how to invoke it."#,
                name = payload.name,
                desc = payload.description,
            ),
            3,
        )
    } else if want_unix_only {
        (
            format!(
                r#"Generate exactly 3 fenced code blocks for a new Unix/macOS/Linux-only agent skill called "{name}".
Description: {desc}

Block 1 - manifest.toml (TOML):
```toml
name = "{name}"
description = "<one-line description>"
version = "1.0.0"
needs_network = <true or false>
needs_fs_read = <true or false>
needs_fs_write = <true or false>
needs_env = <true or false>
platform = "{platform}"
```

Block 2 - skill.md (Markdown):
```markdown
# {name}
<usage docs for the agent: when to use, what args it takes ($1, $2, ...), example invocations>
```

Block 3 - run.sh (Shell):
```sh
#!/bin/sh
<real shell script that implements the skill, uses $1 $2 etc. for args>
```

Rules:
- Output ONLY these 3 fenced code blocks, nothing else.
- run.sh MUST start with #!/bin/sh and be a real executable shell script.
- Use $1, $2, etc. for positional arguments in run.sh.
- manifest.toml MUST be valid TOML with platform = "{platform}".
- skill.md must document what the skill does and how to invoke it."#,
                name = payload.name,
                desc = payload.description,
                platform = platform.unwrap_or("macos"),
            ),
            3,
        )
    } else {
        return Json(serde_json::json!({
            "success": false,
            "error": format!("Invalid platform: {}. Use 'all', 'windows', 'macos', or 'linux'.", payload.platform.as_deref().unwrap_or(""))
        }));
    };

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content:
                "You are a skill-file generator. Output only the requested fenced code blocks."
                    .to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: prompt,
        },
    ];

    // 4. Call the LLM
    let llm_response = {
        let llm = llm_mutex.read().await;
        match llm.generate_with_selected(&messages).await {
            Ok(r) => r,
            Err(e) => {
                return Json(
                    serde_json::json!({ "success": false, "error": format!("LLM call failed: {}", e) }),
                );
            }
        }
    };

    // 5. Parse code blocks via regex
    let re = regex::Regex::new(
        r"```(?:toml|markdown|md|sh|shell|bash|powershell|ps1)\s*\n([\s\S]*?)```",
    )
    .unwrap();
    let blocks: Vec<&str> = re
        .captures_iter(&llm_response)
        .map(|c| c.get(1).unwrap().as_str().trim())
        .collect();

    if blocks.len() < expected_blocks {
        return Json(serde_json::json!({
            "success": false,
            "error": format!("LLM returned {} code blocks instead of {}. Raw response:\n{}", blocks.len(), expected_blocks, llm_response)
        }));
    }

    let manifest_content = blocks[0];
    let skill_md_content = blocks[1];
    let (run_sh_content, run_ps1_content) = if want_both {
        (Some(blocks[2].to_string()), Some(blocks[3].to_string()))
    } else if want_windows_only {
        (None, Some(blocks[2].to_string()))
    } else {
        (Some(blocks[2].to_string()), None)
    };

    // 6. Validate manifest TOML
    if let Err(e) = toml::from_str::<SkillManifest>(manifest_content) {
        return Json(serde_json::json!({
            "success": false,
            "error": format!("Generated manifest.toml is invalid: {}. Content:\n{}", e, manifest_content)
        }));
    }

    // 6. Install via SkillManager
    let skill_reg = state.skill_registry.lock().await;
    let skill_mutex = match skill_reg.get(&agent) {
        Some(m) => m.clone(),
        None => {
            return Json(
                serde_json::json!({ "success": false, "error": "Agent skill registry not found" }),
            );
        }
    };
    drop(skill_reg);

    let mut sm = skill_mutex.lock().await;
    match sm
        .install_skill(
            manifest_content,
            run_sh_content.as_deref(),
            run_ps1_content.as_deref(),
            skill_md_content,
        )
        .await
    {
        Ok(_) => {
            info!(
                "LLM-generated skill '{}' installed for agent '{}'",
                payload.name, agent
            );
            Json(serde_json::json!({ "success": true }))
        }
        Err(e) => Json(
            serde_json::json!({ "success": false, "error": format!("install_skill failed: {}", e) }),
        ),
    }
}

pub async fn get_skills_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.skill_registry.lock().await;
    if let Some(skill_mutex) = reg.get(&agent) {
        let sm = skill_mutex.lock().await;
        let skills = sm.get_all_skills();
        Json(serde_json::json!({ "success": true, "skills": skills }))
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct InstallSkillRequest {
    new_manifest_content: String,
    /// run.sh content (required for Unix skills; omit for Windows-only)
    new_run_sh: Option<String>,
    /// run.ps1 content (optional for cross-platform; required for Windows-only)
    new_run_ps1: Option<String>,
    new_skill_md: String,
}

pub async fn install_skill_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<InstallSkillRequest>,
) -> Json<serde_json::Value> {
    let reg = state.skill_registry.lock().await;
    if let Some(skill_mutex) = reg.get(&agent) {
        let mut sm = skill_mutex.lock().await;
        match sm
            .install_skill(
                &payload.new_manifest_content,
                payload.new_run_sh.as_deref(),
                payload.new_run_ps1.as_deref(),
                &payload.new_skill_md,
            )
            .await
        {
            Ok(_) => Json(
                serde_json::json!({ "success": true, "message": "Skill installed successfully." }),
            ),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct UpgradeSkillRequest {
    skill_name: String,
    new_version_str: String,
    new_manifest_content: String,
    new_run_sh: Option<String>,
    new_run_ps1: Option<String>,
    new_skill_md: String,
}

pub async fn upgrade_skill_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<UpgradeSkillRequest>,
) -> Json<serde_json::Value> {
    let reg = state.skill_registry.lock().await;
    if let Some(skill_mutex) = reg.get(&agent) {
        let mut sm = skill_mutex.lock().await;
        match sm
            .upgrade_skill(
                &payload.skill_name,
                &payload.new_version_str,
                &payload.new_manifest_content,
                payload.new_run_sh.as_deref(),
                payload.new_run_ps1.as_deref(),
                &payload.new_skill_md,
            )
            .await
        {
            Ok(_) => Json(
                serde_json::json!({ "success": true, "message": "Skill upgraded successfully and hot-reloaded." }),
            ),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct InstallOpenclawRequest {
    url: String,
}

pub async fn install_openclaw_skill_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<InstallOpenclawRequest>,
) -> Json<serde_json::Value> {
    let reg = state.skill_registry.lock().await;
    if let Some(skill_mutex) = reg.get(&agent) {
        let mut sm = skill_mutex.lock().await;
        match sm.install_openclaw_skill(&payload.url).await {
            Ok(_) => Json(serde_json::json!({
                "success": true,
                "message": "Openclaw skill installed successfully."
            })),
            Err(e) => Json(serde_json::json!({
                "success": false,
                "error": e.to_string()
            })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

pub async fn remove_skill_endpoint(
    Path((agent, skill_name)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.skill_registry.lock().await;
    if let Some(skill_mutex) = reg.get(&agent) {
        let mut sm = skill_mutex.lock().await;
        match sm.remove_skill(&skill_name).await {
            Ok(_) => Json(
                serde_json::json!({ "success": true, "message": format!("Skill '{}' removed successfully.", skill_name) }),
            ),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}

#[derive(serde::Deserialize)]
pub struct ModifySkillRequest {
    skill_name: String,
    file_name: String,
    content: String,
}

pub async fn modify_skill_endpoint(
    Path((agent, _skill_name)): Path<(String, String)>,
    State(state): State<AppState>,
    Json(payload): Json<ModifySkillRequest>,
) -> Json<serde_json::Value> {
    let reg = state.skill_registry.lock().await;
    if let Some(skill_mutex) = reg.get(&agent) {
        let mut sm = skill_mutex.lock().await;
        match sm
            .modify_skill_file(&payload.skill_name, &payload.file_name, &payload.content)
            .await
        {
            Ok(_) => Json(
                serde_json::json!({ "success": true, "message": format!("Modified {}/{} successfully.", payload.skill_name, payload.file_name) }),
            ),
            Err(e) => Json(serde_json::json!({ "success": false, "error": e.to_string() })),
        }
    } else {
        Json(serde_json::json!({ "success": false, "error": "Agent not found" }))
    }
}
