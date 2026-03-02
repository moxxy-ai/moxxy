use async_trait::async_trait;
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;

use crate::context::PrimitiveContext;
use crate::registry::{Primitive, PrimitiveError};

async fn run_git(
    args: &[&str],
    cwd: &str,
    timeout: Duration,
) -> Result<(String, String, i32), PrimitiveError> {
    let child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| PrimitiveError::ExecutionFailed(format!("Failed to spawn git: {}", e)))?;

    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(result) => result.map_err(|e| PrimitiveError::ExecutionFailed(e.to_string()))?,
        Err(_) => return Err(PrimitiveError::Timeout),
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);

    Ok((stdout, stderr, code))
}

fn inject_token_into_url(url: &str, token: &str) -> String {
    if let Some(rest) = url.strip_prefix("https://") {
        format!("https://{}@{}", token, rest)
    } else {
        url.to_string()
    }
}

fn parse_remote_url(remote_url: &str) -> Option<(String, String)> {
    // Parse owner/repo from URLs like:
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    let cleaned = remote_url.trim();
    let path = if let Some(rest) = cleaned.strip_prefix("https://github.com/") {
        rest
    } else if let Some(rest) = cleaned.strip_prefix("git@github.com:") {
        rest
    } else {
        return None;
    };
    let path = path.strip_suffix(".git").unwrap_or(path);
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() >= 2 {
        Some((parts[0].to_string(), parts[1].to_string()))
    } else {
        None
    }
}

// --- git.clone ---

pub struct GitClonePrimitive {
    ctx: PrimitiveContext,
    workspace_root: PathBuf,
}

impl GitClonePrimitive {
    pub fn new(ctx: PrimitiveContext, workspace_root: PathBuf) -> Self {
        Self {
            ctx,
            workspace_root,
        }
    }
}

#[async_trait]
impl Primitive for GitClonePrimitive {
    fn name(&self) -> &str {
        "git.clone"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let url = params["url"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'url' parameter".into()))?;

        let clone_path = params["path"]
            .as_str()
            .map(|p| self.workspace_root.join(p))
            .unwrap_or_else(|| {
                let repo_name = url
                    .rsplit('/')
                    .next()
                    .unwrap_or("repo")
                    .strip_suffix(".git")
                    .unwrap_or("repo");
                self.workspace_root.join(repo_name)
            });

        // Inject token for private repos
        let auth_url = if let Ok(Some(token)) = self.ctx.resolve_secret("github-token") {
            inject_token_into_url(url, &token)
        } else {
            url.to_string()
        };

        let mut args = vec!["clone", &auth_url];
        let path_str = clone_path.to_string_lossy().to_string();
        args.push(&path_str);

        let branch_arg;
        if let Some(branch) = params["branch"].as_str() {
            args.push("--branch");
            branch_arg = branch.to_string();
            args.push(&branch_arg);
        }

        let depth_arg;
        if let Some(depth) = params["depth"].as_u64() {
            args.push("--depth");
            depth_arg = depth.to_string();
            args.push(&depth_arg);
        }

        let (stdout, stderr, code) = run_git(
            &args,
            self.workspace_root.to_str().unwrap_or("."),
            Duration::from_secs(120),
        )
        .await?;

        if code != 0 {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "git clone failed (exit {}): {}",
                code, stderr
            )));
        }

        // Get commit hash
        let (hash_out, _, _) = run_git(&["rev-parse", "HEAD"], &path_str, Duration::from_secs(5))
            .await
            .unwrap_or_default();

        // Get branch
        let (branch_out, _, _) = run_git(
            &["branch", "--show-current"],
            &path_str,
            Duration::from_secs(5),
        )
        .await
        .unwrap_or_default();

        Ok(serde_json::json!({
            "path": path_str,
            "branch": branch_out.trim(),
            "commit_hash": hash_out.trim(),
            "stdout": stdout.chars().take(500).collect::<String>(),
        }))
    }
}

// --- git.init ---

pub struct GitInitPrimitive {
    workspace_root: PathBuf,
}

impl GitInitPrimitive {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }
}

#[async_trait]
impl Primitive for GitInitPrimitive {
    fn name(&self) -> &str {
        "git.init"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let init_path = params["path"]
            .as_str()
            .map(|p| self.workspace_root.join(p))
            .unwrap_or_else(|| self.workspace_root.clone());

        let path_str = init_path.to_string_lossy().to_string();

        // Create directory if it doesn't exist
        if !init_path.exists() {
            std::fs::create_dir_all(&init_path).map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("Failed to create directory: {}", e))
            })?;
        }

        let mut args = vec!["init"];
        let branch_arg;
        if let Some(branch) = params["default_branch"].as_str() {
            args.push("--initial-branch");
            branch_arg = branch.to_string();
            args.push(&branch_arg);
        }

        let (stdout, stderr, code) = run_git(&args, &path_str, Duration::from_secs(10)).await?;

        if code != 0 {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "git init failed (exit {}): {}",
                code, stderr
            )));
        }

        // Get current branch
        let (branch_out, _, _) = run_git(
            &["branch", "--show-current"],
            &path_str,
            Duration::from_secs(5),
        )
        .await
        .unwrap_or_default();

        Ok(serde_json::json!({
            "path": path_str,
            "branch": branch_out.trim(),
            "stdout": stdout.chars().take(500).collect::<String>(),
        }))
    }
}

// --- git.status ---

pub struct GitStatusPrimitive;

impl GitStatusPrimitive {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GitStatusPrimitive {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Primitive for GitStatusPrimitive {
    fn name(&self) -> &str {
        "git.status"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;

        let (porcelain, _, code) =
            run_git(&["status", "--porcelain"], path, Duration::from_secs(10)).await?;

        if code != 0 {
            return Err(PrimitiveError::ExecutionFailed("git status failed".into()));
        }

        let mut modified = vec![];
        let mut untracked = vec![];
        let mut staged = vec![];

        for line in porcelain.lines() {
            if line.len() < 4 {
                continue;
            }
            let status = &line[..2];
            let file = line[3..].trim().to_string();
            match status {
                "??" => untracked.push(file),
                s if s.starts_with('M') || s.starts_with('A') || s.starts_with('D') => {
                    staged.push(file);
                }
                s if s.ends_with('M') => modified.push(file),
                _ => modified.push(file),
            }
        }

        let (branch_out, _, _) =
            run_git(&["branch", "--show-current"], path, Duration::from_secs(5))
                .await
                .unwrap_or_default();

        Ok(serde_json::json!({
            "branch": branch_out.trim(),
            "modified": modified,
            "untracked": untracked,
            "staged": staged,
        }))
    }
}

// --- git.commit ---

pub struct GitCommitPrimitive {
    ctx: PrimitiveContext,
}

impl GitCommitPrimitive {
    pub fn new(ctx: PrimitiveContext) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Primitive for GitCommitPrimitive {
    fn name(&self) -> &str {
        "git.commit"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;
        let message = params["message"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'message' parameter".into()))?;

        // Configure user.name and user.email from vault
        if let Ok(Some(user)) = self.ctx.resolve_secret("github-user") {
            let _ = run_git(
                &["config", "user.name", &user],
                path,
                Duration::from_secs(5),
            )
            .await;
        }
        if let Ok(Some(email)) = self.ctx.resolve_secret("github-email") {
            let _ = run_git(
                &["config", "user.email", &email],
                path,
                Duration::from_secs(5),
            )
            .await;
        }

        // Stage files
        let files: Vec<String> = params["files"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        if files.is_empty() {
            let (_, stderr, code) = run_git(&["add", "-A"], path, Duration::from_secs(30)).await?;
            if code != 0 {
                return Err(PrimitiveError::ExecutionFailed(format!(
                    "git add failed: {}",
                    stderr
                )));
            }
        } else {
            let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
            let mut args = vec!["add"];
            args.extend(file_refs);
            let (_, stderr, code) = run_git(&args, path, Duration::from_secs(30)).await?;
            if code != 0 {
                return Err(PrimitiveError::ExecutionFailed(format!(
                    "git add failed: {}",
                    stderr
                )));
            }
        }

        // Commit
        let (stdout, stderr, code) =
            run_git(&["commit", "-m", message], path, Duration::from_secs(30)).await?;
        if code != 0 {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "git commit failed: {}",
                stderr
            )));
        }

        // Get commit hash
        let (hash_out, _, _) = run_git(&["rev-parse", "HEAD"], path, Duration::from_secs(5))
            .await
            .unwrap_or_default();

        Ok(serde_json::json!({
            "commit_hash": hash_out.trim(),
            "message": message,
            "stdout": stdout.chars().take(500).collect::<String>(),
        }))
    }
}

// --- git.push ---

pub struct GitPushPrimitive {
    ctx: PrimitiveContext,
}

impl GitPushPrimitive {
    pub fn new(ctx: PrimitiveContext) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Primitive for GitPushPrimitive {
    fn name(&self) -> &str {
        "git.push"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;
        let remote = params["remote"].as_str().unwrap_or("origin");
        let branch = params["branch"].as_str();
        let force = params["force"].as_bool().unwrap_or(false);

        // Set up credential helper via token
        if let Ok(Some(token)) = self.ctx.resolve_secret("github-token") {
            // Get current remote URL and inject token
            let (remote_url, _, _) =
                run_git(&["remote", "get-url", remote], path, Duration::from_secs(5))
                    .await
                    .unwrap_or_default();

            let auth_url = inject_token_into_url(remote_url.trim(), &token);
            let _ = run_git(
                &["remote", "set-url", remote, &auth_url],
                path,
                Duration::from_secs(5),
            )
            .await;
        }

        let mut args = vec!["push", remote];
        if let Some(b) = branch {
            args.push(b);
        }
        if force {
            args.push("--force");
        }

        let (stdout, stderr, code) = run_git(&args, path, Duration::from_secs(60)).await?;

        if code != 0 {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "git push failed: {}",
                stderr
            )));
        }

        Ok(serde_json::json!({
            "remote": remote,
            "branch": branch.unwrap_or("current"),
            "status": "pushed",
            "output": format!("{}{}", stdout, stderr).chars().take(500).collect::<String>(),
        }))
    }
}

// --- git.checkout ---

pub struct GitCheckoutPrimitive;

impl GitCheckoutPrimitive {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GitCheckoutPrimitive {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Primitive for GitCheckoutPrimitive {
    fn name(&self) -> &str {
        "git.checkout"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;
        let branch = params["branch"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'branch' parameter".into()))?;
        let create = params["create"].as_bool().unwrap_or(false);

        let args = if create {
            vec!["checkout", "-b", branch]
        } else {
            vec!["checkout", branch]
        };

        let (_, stderr, code) = run_git(&args, path, Duration::from_secs(30)).await?;

        if code != 0 {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "git checkout failed: {}",
                stderr
            )));
        }

        Ok(serde_json::json!({
            "branch": branch,
            "created": create,
        }))
    }
}

// --- git.pr_create ---

pub struct GitPrCreatePrimitive {
    ctx: PrimitiveContext,
}

impl GitPrCreatePrimitive {
    pub fn new(ctx: PrimitiveContext) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Primitive for GitPrCreatePrimitive {
    fn name(&self) -> &str {
        "git.pr_create"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;
        let title = params["title"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'title' parameter".into()))?;
        let body = params["body"].as_str().unwrap_or("");
        let base = params["base"].as_str();

        let token = self.ctx.resolve_secret("github-token")?.ok_or_else(|| {
            PrimitiveError::AccessDenied(
                "github-token not found in vault or agent lacks grant".into(),
            )
        })?;

        // Get remote URL to infer owner/repo
        let (remote_url, _, _) = run_git(
            &["remote", "get-url", "origin"],
            path,
            Duration::from_secs(5),
        )
        .await?;

        let (owner, repo) = parse_remote_url(remote_url.trim()).ok_or_else(|| {
            PrimitiveError::ExecutionFailed("Cannot parse owner/repo from remote URL".into())
        })?;

        // Get current branch as head
        let (branch_out, _, _) =
            run_git(&["branch", "--show-current"], path, Duration::from_secs(5)).await?;
        let head = params["head"].as_str().unwrap_or(branch_out.trim());

        let base_branch = base.unwrap_or("main");

        // Create PR via GitHub API
        let client = reqwest::Client::new();
        let api_url = format!("https://api.github.com/repos/{}/{}/pulls", owner, repo);

        let resp = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Moxxy/1.0")
            .json(&serde_json::json!({
                "title": title,
                "body": body,
                "head": head,
                "base": base_branch,
            }))
            .send()
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("GitHub API error: {}", e)))?;

        let status = resp.status().as_u16();
        let resp_json: serde_json::Value = resp.json().await.map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("Failed to parse GitHub response: {}", e))
        })?;

        if status >= 400 {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "GitHub API returned {}: {}",
                status,
                resp_json["message"].as_str().unwrap_or("unknown error")
            )));
        }

        Ok(serde_json::json!({
            "pr_number": resp_json["number"],
            "pr_url": resp_json["url"],
            "html_url": resp_json["html_url"],
            "state": resp_json["state"],
        }))
    }
}

// --- git.fork ---

pub struct GitForkPrimitive {
    ctx: PrimitiveContext,
}

impl GitForkPrimitive {
    pub fn new(ctx: PrimitiveContext) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Primitive for GitForkPrimitive {
    fn name(&self) -> &str {
        "git.fork"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let owner = params["owner"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'owner' parameter".into()))?;
        let repo = params["repo"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'repo' parameter".into()))?;

        let token = self.ctx.resolve_secret("github-token")?.ok_or_else(|| {
            PrimitiveError::AccessDenied(
                "github-token not found in vault or agent lacks grant".into(),
            )
        })?;

        let client = reqwest::Client::new();
        let api_url = format!("https://api.github.com/repos/{}/{}/forks", owner, repo);

        let resp = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Moxxy/1.0")
            .json(&serde_json::json!({}))
            .send()
            .await
            .map_err(|e| PrimitiveError::ExecutionFailed(format!("GitHub API error: {}", e)))?;

        let status = resp.status().as_u16();
        let resp_json: serde_json::Value = resp.json().await.map_err(|e| {
            PrimitiveError::ExecutionFailed(format!("Failed to parse GitHub response: {}", e))
        })?;

        if status >= 400 {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "GitHub API returned {}: {}",
                status,
                resp_json["message"].as_str().unwrap_or("unknown error")
            )));
        }

        Ok(serde_json::json!({
            "fork_url": resp_json["clone_url"],
            "full_name": resp_json["full_name"],
            "html_url": resp_json["html_url"],
        }))
    }
}

// --- git.worktree_add ---

pub struct GitWorktreeAddPrimitive {
    workspace_root: PathBuf,
}

impl GitWorktreeAddPrimitive {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }
}

#[async_trait]
impl Primitive for GitWorktreeAddPrimitive {
    fn name(&self) -> &str {
        "git.worktree_add"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let repo_path = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;

        let branch = params["branch"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'branch' parameter".into()))?;

        // Worktree destination: workspace_root/.worktrees/{branch}
        let worktree_dir = params["worktree_path"]
            .as_str()
            .map(|p| self.workspace_root.join(p))
            .unwrap_or_else(|| self.workspace_root.join(".worktrees").join(branch));

        let worktree_str = worktree_dir.to_string_lossy().to_string();

        // Create parent directory if needed
        if let Some(parent) = worktree_dir.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                PrimitiveError::ExecutionFailed(format!("Failed to create worktree parent: {}", e))
            })?;
        }

        let create_branch = params["create_branch"].as_bool().unwrap_or(true);

        let args = if create_branch {
            vec!["worktree", "add", "-b", branch, &worktree_str]
        } else {
            vec!["worktree", "add", &worktree_str, branch]
        };

        let (stdout, stderr, code) = run_git(&args, repo_path, Duration::from_secs(30)).await?;

        if code != 0 {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "git worktree add failed (exit {}): {}",
                code, stderr
            )));
        }

        Ok(serde_json::json!({
            "worktree_path": worktree_str,
            "branch": branch,
            "stdout": stdout.chars().take(500).collect::<String>(),
        }))
    }
}

// --- git.worktree_list ---

pub struct GitWorktreeListPrimitive;

impl GitWorktreeListPrimitive {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GitWorktreeListPrimitive {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Primitive for GitWorktreeListPrimitive {
    fn name(&self) -> &str {
        "git.worktree_list"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path = params["path"]
            .as_str()
            .ok_or_else(|| PrimitiveError::InvalidParams("missing 'path' parameter".into()))?;

        let (stdout, stderr, code) = run_git(
            &["worktree", "list", "--porcelain"],
            path,
            Duration::from_secs(10),
        )
        .await?;

        if code != 0 {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "git worktree list failed (exit {}): {}",
                code, stderr
            )));
        }

        // Parse porcelain output: blocks separated by blank lines
        // Each block has: worktree <path>\nHEAD <sha>\nbranch <ref>\n
        let mut worktrees = vec![];
        let mut current = serde_json::Map::new();

        for line in stdout.lines() {
            if line.is_empty() {
                if !current.is_empty() {
                    worktrees.push(serde_json::Value::Object(current.clone()));
                    current.clear();
                }
                continue;
            }
            if let Some(path) = line.strip_prefix("worktree ") {
                current.insert("path".into(), serde_json::Value::String(path.to_string()));
            } else if let Some(head) = line.strip_prefix("HEAD ") {
                current.insert("head".into(), serde_json::Value::String(head.to_string()));
            } else if let Some(branch) = line.strip_prefix("branch ") {
                current.insert(
                    "branch".into(),
                    serde_json::Value::String(branch.to_string()),
                );
            } else if line == "bare" {
                current.insert("bare".into(), serde_json::Value::Bool(true));
            } else if line == "detached" {
                current.insert("detached".into(), serde_json::Value::Bool(true));
            }
        }
        if !current.is_empty() {
            worktrees.push(serde_json::Value::Object(current));
        }

        Ok(serde_json::json!({ "worktrees": worktrees }))
    }
}

// --- git.worktree_remove ---

pub struct GitWorktreeRemovePrimitive;

impl GitWorktreeRemovePrimitive {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GitWorktreeRemovePrimitive {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Primitive for GitWorktreeRemovePrimitive {
    fn name(&self) -> &str {
        "git.worktree_remove"
    }

    async fn invoke(&self, params: serde_json::Value) -> Result<serde_json::Value, PrimitiveError> {
        let path = params["path"].as_str().ok_or_else(|| {
            PrimitiveError::InvalidParams("missing 'path' parameter (main repo)".into())
        })?;

        let worktree_path = params["worktree_path"].as_str().ok_or_else(|| {
            PrimitiveError::InvalidParams("missing 'worktree_path' parameter".into())
        })?;

        let force = params["force"].as_bool().unwrap_or(false);

        let mut args = vec!["worktree", "remove", worktree_path];
        if force {
            args.push("--force");
        }

        let (stdout, stderr, code) = run_git(&args, path, Duration::from_secs(30)).await?;

        if code != 0 {
            return Err(PrimitiveError::ExecutionFailed(format!(
                "git worktree remove failed (exit {}): {}",
                code, stderr
            )));
        }

        Ok(serde_json::json!({
            "removed": worktree_path,
            "stdout": stdout.chars().take(500).collect::<String>(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inject_token_works() {
        let url = "https://github.com/user/repo.git";
        let result = inject_token_into_url(url, "ghp_abc123");
        assert_eq!(result, "https://ghp_abc123@github.com/user/repo.git");
    }

    #[test]
    fn inject_token_leaves_non_https() {
        let url = "git@github.com:user/repo.git";
        let result = inject_token_into_url(url, "token");
        assert_eq!(result, "git@github.com:user/repo.git");
    }

    #[test]
    fn parse_remote_https() {
        let (owner, repo) = parse_remote_url("https://github.com/octocat/hello-world.git").unwrap();
        assert_eq!(owner, "octocat");
        assert_eq!(repo, "hello-world");
    }

    #[test]
    fn parse_remote_ssh() {
        let (owner, repo) = parse_remote_url("git@github.com:octocat/hello-world.git").unwrap();
        assert_eq!(owner, "octocat");
        assert_eq!(repo, "hello-world");
    }

    #[test]
    fn parse_remote_no_git_suffix() {
        let (owner, repo) = parse_remote_url("https://github.com/org/project").unwrap();
        assert_eq!(owner, "org");
        assert_eq!(repo, "project");
    }

    #[test]
    fn parse_remote_returns_none_for_unknown() {
        assert!(parse_remote_url("https://gitlab.com/user/repo").is_none());
    }

    #[tokio::test]
    async fn git_init_creates_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let prim = GitInitPrimitive::new(tmp.path().to_path_buf());
        let result = prim
            .invoke(serde_json::json!({"path": "my-project"}))
            .await
            .unwrap();
        assert_eq!(
            result["path"],
            tmp.path().join("my-project").to_string_lossy().to_string()
        );
        // Verify .git directory was created
        assert!(tmp.path().join("my-project/.git").exists());
    }

    #[tokio::test]
    async fn git_init_with_default_branch() {
        let tmp = tempfile::tempdir().unwrap();
        let prim = GitInitPrimitive::new(tmp.path().to_path_buf());
        let result = prim
            .invoke(serde_json::json!({"path": "proj", "default_branch": "main"}))
            .await
            .unwrap();
        assert_eq!(result["branch"], "main");
    }

    #[tokio::test]
    async fn git_init_uses_workspace_root_when_no_path() {
        let tmp = tempfile::tempdir().unwrap();
        let prim = GitInitPrimitive::new(tmp.path().to_path_buf());
        let result = prim.invoke(serde_json::json!({})).await.unwrap();
        assert_eq!(result["path"], tmp.path().to_string_lossy().to_string());
        assert!(tmp.path().join(".git").exists());
    }

    #[tokio::test]
    async fn git_status_requires_path() {
        let prim = GitStatusPrimitive::new();
        let result = prim.invoke(serde_json::json!({})).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn git_worktree_add_creates_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let repo_path = tmp.path().join("repo");
        std::fs::create_dir_all(&repo_path).unwrap();

        // Init a repo with an initial commit (worktree requires at least one commit)
        run_git(
            &["init"],
            repo_path.to_str().unwrap(),
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        std::fs::write(repo_path.join("README.md"), "# Test").unwrap();
        run_git(
            &["add", "."],
            repo_path.to_str().unwrap(),
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        run_git(
            &[
                "commit",
                "-m",
                "initial",
                "--author",
                "Test <test@test.com>",
            ],
            repo_path.to_str().unwrap(),
            Duration::from_secs(5),
        )
        .await
        .unwrap();

        let prim = GitWorktreeAddPrimitive::new(tmp.path().to_path_buf());
        let result = prim
            .invoke(serde_json::json!({
                "path": repo_path.to_str().unwrap(),
                "branch": "feature-x",
            }))
            .await
            .unwrap();

        let wt_path = result["worktree_path"].as_str().unwrap();
        assert!(std::path::Path::new(wt_path).exists());
        assert_eq!(result["branch"], "feature-x");
    }

    #[tokio::test]
    async fn git_worktree_add_requires_path_and_branch() {
        let tmp = tempfile::tempdir().unwrap();
        let prim = GitWorktreeAddPrimitive::new(tmp.path().to_path_buf());
        let result = prim.invoke(serde_json::json!({"path": "/tmp"})).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn git_worktree_list_on_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let repo_path = tmp.path().join("repo");
        std::fs::create_dir_all(&repo_path).unwrap();
        run_git(
            &["init"],
            repo_path.to_str().unwrap(),
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        std::fs::write(repo_path.join("f.txt"), "x").unwrap();
        run_git(
            &["add", "."],
            repo_path.to_str().unwrap(),
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        run_git(
            &["commit", "-m", "init", "--author", "T <t@t.com>"],
            repo_path.to_str().unwrap(),
            Duration::from_secs(5),
        )
        .await
        .unwrap();

        let prim = GitWorktreeListPrimitive::new();
        let result = prim
            .invoke(serde_json::json!({"path": repo_path.to_str().unwrap()}))
            .await
            .unwrap();
        let wts = result["worktrees"].as_array().unwrap();
        assert!(!wts.is_empty());
        assert!(wts[0]["path"].as_str().is_some());
    }

    #[tokio::test]
    async fn git_worktree_list_requires_path() {
        let prim = GitWorktreeListPrimitive::new();
        let result = prim.invoke(serde_json::json!({})).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn git_worktree_remove_requires_both_paths() {
        let prim = GitWorktreeRemovePrimitive::new();
        let result = prim.invoke(serde_json::json!({"path": "/tmp"})).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }

    #[tokio::test]
    async fn git_checkout_requires_path_and_branch() {
        let prim = GitCheckoutPrimitive::new();
        let result = prim.invoke(serde_json::json!({"path": "/tmp"})).await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PrimitiveError::InvalidParams(_)
        ));
    }
}
