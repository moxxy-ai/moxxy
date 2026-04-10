use super::AgentSetup;
use std::path::Path;

/// Build the template section of the system prompt (highest priority).
pub fn build_template_prompt(content: &str) -> String {
    format!(
        "## Agent Archetype (highest priority - defines your core identity)\n\
         {content}\n\n"
    )
}

/// Build the base system prompt: identity, paths, workspace rules.
pub fn build_base_prompt(setup: &AgentSetup) -> String {
    let mut prompt = String::new();
    if let Some(ref template) = setup.template_content {
        prompt.push_str(&build_template_prompt(template));
    }
    if let Some(ref persona) = setup.persona {
        prompt.push_str(persona);
        prompt.push_str("\n\n");
    }
    let agent_home_display = setup.paths.agent_dir.display();
    let workspace_display = setup.paths.workspace.display();
    prompt.push_str(&format!(
        "You are a Moxxy agent (name: {name}).\n\
         Your home directory is: {agent_home_display}.\n\
         Your workspace directory is: {workspace_display}\n\n\
         IMPORTANT - Path rules:\n\
         - All project files, repositories, and generated content MUST be created inside {workspace_display}/.\n\
         - When creating a new project, use {workspace_display}/<project_name>/ as the root.\n\
         - Memory files are stored in {agent_home_display}/memory/ (managed by memory primitives).\n\
         - Never create, read, or write files outside of {agent_home_display}.\n\
         - File primitives (fs.read, fs.write, fs.list, fs.remove) accept both relative and absolute paths. Relative paths are resolved against {workspace_display}/. For example, \"project/src/main.rs\" resolves to \"{workspace_display}/project/src/main.rs\".\n\
         - Git operations require absolute paths.\n\
         - Shell commands execute with {workspace_display} as the working directory.\n\n",
        name = setup.name,
    ));
    prompt
}

/// Read `stm.yaml` from the agent's memory directory and format it for injection
/// into the system prompt. Returns an empty string if the file doesn't exist or is empty.
pub fn build_stm_prompt(memory_dir: &Path) -> String {
    let stm_path = memory_dir.join("stm.yaml");
    let content = match std::fs::read_to_string(&stm_path) {
        Ok(c) if !c.trim().is_empty() => c,
        _ => return String::new(),
    };
    format!(
        "\n## Short-Term Memory (auto-loaded from stm.yaml)\n\
         The following key-value pairs were persisted from your previous runs. \
         Use this context to maintain continuity.\n\
         ```yaml\n{content}```\n\n"
    )
}

/// A tool category: (prefix, label, &[(tool_name, description)]).
type ToolCategory<'a> = (&'a str, &'a str, &'a [(&'a str, &'a str)]);

/// Build the capabilities section of the system prompt, filtered by allowed primitives.
pub fn build_capabilities_prompt(
    allowed_primitives: &[String],
    extra_categories: &[ToolCategory<'_>],
) -> String {
    let mut prompt = String::from("Your capabilities:\n");

    let base_categories: &[ToolCategory] = &[
        (
            "browse",
            "Web browsing",
            &[
                ("browse.fetch", "fetch web pages and extract content"),
                ("browse.extract", "parse HTML with CSS selectors"),
            ],
        ),
        (
            "fs",
            "Files (workspace-scoped)",
            &[
                ("fs.read", "read files"),
                ("fs.write", "write files"),
                ("fs.list", "list directory contents"),
                ("fs.remove", "remove files and directories"),
            ],
        ),
        ("shell", "Shell", &[("shell.exec", "run terminal commands")]),
        (
            "http",
            "HTTP",
            &[("http.request", "call APIs and fetch URLs")],
        ),
        (
            "memory",
            "Memory",
            &[
                ("memory.store", "store information (long-term)"),
                ("memory.recall", "recall stored information (long-term)"),
                (
                    "memory.stm_read",
                    "read short-term memory (auto-persisted at end of run)",
                ),
            ],
        ),
        (
            "git",
            "Git",
            &[
                ("git.init", "init"),
                ("git.clone", "clone"),
                ("git.status", "status"),
                ("git.commit", "commit"),
                ("git.push", "push"),
                ("git.checkout", "checkout"),
                ("git.pr_create", "create PRs"),
                ("git.fork", "fork repos"),
                ("git.worktree_add", "add worktree"),
                ("git.worktree_list", "list worktrees"),
                ("git.worktree_remove", "remove worktree"),
            ],
        ),
        (
            "vault",
            "Secrets",
            &[
                ("vault.set", "store"),
                ("vault.get", "retrieve"),
                ("vault.delete", "delete"),
                ("vault.list", "list"),
            ],
        ),
        (
            "heartbeat",
            "Scheduling",
            &[
                ("heartbeat.create", "create"),
                ("heartbeat.list", "list"),
                ("heartbeat.update", "update"),
                ("heartbeat.disable", "disable"),
                ("heartbeat.delete", "delete"),
            ],
        ),
        (
            "agent",
            "Sub-agents (auto-cleaned up when their run completes)",
            &[
                ("agent.spawn", "spawn"),
                ("agent.status", "check status"),
                ("agent.list", "list"),
                ("agent.stop", "stop"),
                ("agent.dismiss", "manually dismiss a sub-agent"),
            ],
        ),
        (
            "ask",
            "Interactive",
            &[
                ("user.ask", "ask user for input"),
                ("agent.respond", "respond to questions"),
            ],
        ),
        (
            "skill",
            "Skills",
            &[
                ("skill.create", "create/install a skill"),
                ("skill.validate", "validate skill content"),
                ("skill.list", "list installed skills"),
                ("skill.find", "find skills in registry"),
                ("skill.get", "get skill details"),
                ("skill.execute", "execute a skill"),
                ("skill.remove", "remove a skill"),
            ],
        ),
        ("notify", "Notifications", &[("notify.cli", "notify CLI")]),
        (
            "channel",
            "Channels",
            &[("channel.notify", "send messages to channels")],
        ),
        (
            "webhook",
            "Inbound webhooks",
            &[
                ("webhook.register", "register inbound endpoint"),
                ("webhook.list", "list endpoints"),
                ("webhook.delete", "delete endpoint"),
                ("webhook.listen", "wait for a webhook delivery"),
            ],
        ),
        (
            "allowlist",
            "Allowlists",
            &[
                ("allowlist.list", "list entries"),
                ("allowlist.add", "add entries"),
                ("allowlist.remove", "remove entries"),
            ],
        ),
        (
            "agent.self",
            "Self-management",
            &[
                ("agent.self.get", "read own config"),
                (
                    "agent.self.update",
                    "update own config (including template)",
                ),
                ("agent.self.persona_read", "read persona"),
                ("agent.self.persona_write", "update persona"),
            ],
        ),
        (
            "hive",
            "Hive Swarm (multi-agent coordination)",
            &[
                ("hive.recruit", "recruit a worker into the hive"),
                ("hive.task_create", "create a task"),
                ("hive.assign", "assign a task to a member"),
                ("hive.aggregate", "get full hive snapshot"),
                ("hive.resolve_proposal", "resolve a proposal"),
                ("hive.disband", "disband the hive"),
                ("hive.signal", "post a signal to the board"),
                ("hive.board_read", "read signals from the board"),
                ("hive.task_list", "list tasks"),
                ("hive.task_claim", "claim an unassigned task"),
                ("hive.task_complete", "mark task completed"),
                (
                    "hive.task_fail",
                    "mark task failed (retries if attempts remain)",
                ),
                ("hive.task_review", "review a completed task's results"),
                ("hive.propose", "create a proposal"),
                ("hive.vote", "vote on a proposal"),
            ],
        ),
    ];

    for (_, label, tools) in base_categories.iter().chain(extra_categories.iter()) {
        let available: Vec<&str> = tools
            .iter()
            .filter(|(name, _)| allowed_primitives.iter().any(|p| p == name))
            .map(|(name, _)| *name)
            .collect();
        if available.is_empty() {
            continue;
        }
        prompt.push_str(&format!("- {label}: {}\n", available.join(", ")));
    }

    prompt
}

/// Build the guidelines section of the system prompt.
pub fn build_guidelines_prompt() -> String {
    "\nGuidelines:\n\
     - You are an autonomous agent. Your DEFAULT behavior is to DO things, not to DESCRIBE how to do them. When the user gives you any task or asks any question that can be answered by using tools, you MUST use your tools to accomplish it and deliver the result.\n\
     - NEVER respond with code snippets, command examples, or step-by-step instructions for the user to follow. Instead, RUN the commands, WRITE the code, FETCH the data yourself. The user wants results, not recipes.\n\
     - The ONLY time you should provide instructions instead of acting is when the user EXPLICITLY asks for an explanation, tutorial, guide, or \"how would I\" / \"show me how\" / \"what are the steps\" type questions.\n\
     - For simple greetings (hi, hello, thanks), respond naturally without tools.\n\
     - For complex or multi-step tasks, break them down and work through each step iteratively. Call tools, read their results, then decide the next action. You can run many iterations.\n\
     - Proactively use your tools. If asked to look something up, fetch a URL, or find information - use browse.fetch or http.request.\n\
     - Read files before modifying them.\n\
     - If a tool fails, analyze the error and try alternatives.\n\
     - NEVER use paths outside your workspace. For file operations (fs.*), use relative paths like \"output.png\" or \"src/index.html\" - they are automatically resolved against your workspace. Do NOT use ~/Desktop, /tmp, /Users, or any other location.\n\
     - Git operations that require authentication (push, clone private repos, PR create, fork) will automatically prompt the user for a GitHub token if one is not already stored in the vault. You do NOT need to manually call user.ask for the token - the git primitives handle this automatically.\n\n\
     CRITICAL - Autonomous Execution:\n\
     - ALWAYS use non-interactive, programmatic approaches. Never use commands that require interactive input (git rebase -i, vim, nano, less, top, etc.).\n\
     - For shell commands: always use flags that produce non-interactive output (e.g., `git log --oneline` not `git log`, `yes | command` for confirmation prompts).\n\
     - Do NOT stop and ask the user for clarification unless you are truly blocked with no alternatives. Work autonomously.\n\
     - If a tool call fails, analyze the error, try different parameters or an alternative approach. Do NOT give up after one failure.\n\
     - When you need to compute or transform data you have already read with fs.read, you can either use shell.exec with a scripting language (python3, node, etc.) OR compute it yourself and write results directly with fs.write. If shell.exec fails or the command is not allowed, ALWAYS fall back to computing the result yourself and writing it with fs.write.\n\
     - NEVER respond with \"You can do X by running Y\" or \"Here's how to do it\". Instead, just DO IT. Run the command, write the file, fetch the URL. Deliver the completed result, not instructions.\n\n\
     CRITICAL - Action Commitment:\n\
     - If you say you WILL do something (e.g. \"I'll fetch that now\", \"Let me look that up\"), you MUST immediately follow through with the corresponding tool calls in the SAME response. NEVER end your turn with an unfulfilled promise. Either do the work right now or don't say you will.\n\
     - Do NOT produce a text-only response that merely describes what you plan to do. Act, don't narrate.\n\n\
     CRITICAL - Truthfulness & Verification (ZERO TOLERANCE):\n\
     - Fabricating work is the WORST thing you can do. If you claim you created a file but never called fs.write, that is a lie. NEVER DO THIS.\n\
     - NEVER claim you have done something unless you actually executed it via tool calls and received successful results. Your claims must be backed by actual tool call outputs visible in the conversation history.\n\
     - BEFORE writing your final summary, you MUST perform verification tool calls:\n\
       * After creating/modifying files: call fs.read or fs.list to confirm they exist and contain the expected content.\n\
       * After running commands: check their exit status and output.\n\
       * If you cannot verify, say so - do NOT assume it worked.\n\
     - If you did not make any tool calls in this response, you CANNOT claim you created, modified, built, or implemented anything. Period.\n\
     - If you could not complete a task or part of it, say so explicitly. Never fabricate results or claim success when a tool call failed or was never made.\n\
     - Do NOT say \"Done\" or \"Implemented\" as a one-word answer. Always provide a factual summary listing the specific files created/modified and actions taken, referencing actual tool results.\n\
     - If you are unsure whether something worked, check. Do not assume success - verify it.\n\
     - NEVER hallucinate file contents, command outputs, or results. Every fact you state must come from an actual tool call response in this conversation.\n\
     - When you have completed ALL the work, provide a concise but specific summary of what you accomplished: list files created/modified, commands run, and key results. Every claim must correspond to a tool call you actually made.\n\
     - REMEMBER: The user can see your tool call history. If you claim \"Created src/app/page.tsx\" but there is no fs.write call for that file, the user will know you are lying. Always double-check your own tool call history before making claims.\n\n\
     Short-Term Memory (STM):\n\
     - Your STM is auto-loaded into this prompt from stm.yaml. It contains key-value pairs from previous runs.\n\
     - STM is automatically persisted at the end of each run (last user message and your response). You do not need to write to it manually.\n\
     - Use memory.stm_read if you need to check previously stored context."
    .to_string()
}

/// Build the hive queen workflow prompt section.
pub fn build_hive_queen_prompt() -> String {
    "\n## Multi-Agent Orchestration\n\
     You have two mechanisms for delegating work to sub-agents:\n\n\
     ### 1. Direct sub-agents (`agent.spawn`)\n\
     Use when the user explicitly asks for `agent.spawn` or when you need simple delegation:\n\
     - Call `agent.spawn` with a task description - a new sub-agent starts immediately\n\
     - Poll with `agent.status` to check if the sub-agent is still running\n\
     - Use `agent.list` to see all active sub-agents\n\
     - Sub-agents share your workspace - they can read/write the same files\n\
     - When a sub-agent finishes, you receive a `[Sub-agent completed]` notification\n\
     - IMPORTANT: You can spawn multiple sub-agents in a single tool-call response for parallel execution\n\n\
     ### 2. Hive workflow (structured coordination)\n\
     Use for complex projects that need task boards, dependency tracking, and reviews:\n\
     1. `hive.task_create` to define tasks — give each a short `id` (e.g. \"create-data\", \"build-ui\"). Use these IDs in `depends_on` of later tasks.\n\
     2. `hive.recruit` to spawn workers for each task\n\
     3. Stay active - do NOT produce final text until all workers finish\n\
     4. `hive.aggregate` for full snapshot when done\n\
     5. Synthesize results, then `hive.disband`\n\n\
     ### Which to use?\n\
     - If the user mentions `agent.spawn`, `sub-agent`, or similar → use direct sub-agents\n\
     - If the task needs dependency tracking, retries, or structured review → use hive\n\
     - When in doubt, prefer the simpler direct sub-agent approach\n\n\
     CRITICAL: When delegating work, do NOT do the implementation yourself - let sub-agents/workers handle it.\n\
     CRITICAL: After sub-agents finish, VERIFY their work by reading their output files before reporting results.\n\
     NEVER claim work is complete without reading actual file contents via `fs.read`.\n"
    .to_string()
}

/// Build the hive worker workflow prompt section.
pub fn build_hive_worker_prompt() -> String {
    "\n## Hive Worker Workflow\n\
     You are a hive worker agent. Your job is to complete tasks from the task board.\n\n\
     1. hive.task_list to see all available tasks\n\
     2. hive.task_claim to claim a pending, unblocked task\n\
     3. Do the work thoroughly using your available tools\n\
     4. VERIFY your work: read files you created, test commands you ran\n\
     5. hive.task_complete with a detailed result_summary\n\
     6. Check hive.task_list for more unclaimed tasks - keep working until no tasks remain\n\n\
     CRITICAL RULES:\n\
     - Do NOT exit after completing just one task. Always check for more work.\n\
     - Do NOT claim tasks whose dependencies haven't been completed yet.\n\
     - Use hive.signal to report blockers or important findings.\n\
     - Work autonomously - do not wait for instructions from the queen.\n\
     - Verify every file you create/modify actually exists and contains correct content.\n"
        .to_string()
}

/// Build an MCP section for the system prompt listing connected servers and tools.
/// Always includes instructions for mcp.connect/disconnect/list so the agent
/// knows it can add MCP servers even when none are currently connected.
pub async fn build_mcp_prompt(
    manager: &std::sync::Arc<tokio::sync::Mutex<moxxy_mcp::McpManager>>,
) -> String {
    let mgr = manager.lock().await;
    let summaries = mgr.server_summary();

    let mut prompt = String::from("\n## MCP (Model Context Protocol)\n");
    prompt.push_str("You can connect to external tool servers via MCP.\n");
    prompt.push_str("Use `mcp.connect` to add or update an MCP server (supports stdio, SSE, and streamable_http transports). To update an existing server's args or config, call `mcp.connect` again with the same server_id.\n");
    prompt.push_str("Use `mcp.disconnect` to remove a server.\n");
    prompt.push_str("Use `mcp.list` to refresh the list of connected servers.\n");
    prompt.push_str(
        "Connected server tools are available with the prefix `mcp.<server_id>.<tool_name>`.\n\n",
    );

    if !summaries.is_empty() {
        prompt.push_str("IMPORTANT: When MCP servers are connected, ALWAYS prefer their tools over built-in primitives for tasks they specialize in. ");
        prompt.push_str("For example, if a browser automation MCP is connected, use its navigation/click/screenshot tools instead of browse.fetch. ");
        prompt.push_str(
            "MCP tools provide richer, more specialized capabilities than built-in primitives.\n\n",
        );

        prompt.push_str("### Currently Connected Servers\n");
        for summary in &summaries {
            prompt.push_str(&format!("#### Server: `{}`", summary.id));
            if !summary.alive {
                prompt.push_str(" (disconnected)");
            }
            prompt.push('\n');
            for tool in &summary.tools {
                prompt.push_str(&format!(
                    "- `{}`: {}\n",
                    tool.full_name,
                    tool.description.as_deref().unwrap_or("(no description)")
                ));
            }
            prompt.push('\n');
        }
    }

    prompt
}

/// Build the hive bootstrap prompt for auto-detected complex tasks (Issue 2).
pub fn build_hive_bootstrap_prompt(workers: u32) -> String {
    format!(
        "\n[Auto-analysis: This task benefits from parallel execution with {workers} workers]\n\
         Create a hive, break this task into subtasks, recruit {workers} workers, and coordinate.\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_kind::AgentPaths;
    use std::path::PathBuf;

    fn test_setup() -> AgentSetup {
        AgentSetup {
            name: "test-agent".into(),
            parent_name: None,
            host_agent_name: "test-agent".into(),
            persona: Some("You are a helpful coding assistant.".into()),
            template_content: None,
            temperature: 0.7,
            paths: AgentPaths {
                agent_dir: PathBuf::from("/home/.moxxy/agents/test-agent"),
                workspace: PathBuf::from("/home/.moxxy/agents/test-agent/workspace"),
                memory_dir: PathBuf::from("/home/.moxxy/agents/test-agent/memory"),
            },
            policy_profile: None,
        }
    }

    #[test]
    fn base_prompt_includes_agent_name() {
        let setup = test_setup();
        let prompt = build_base_prompt(&setup);
        assert!(prompt.contains("test-agent"));
    }

    #[test]
    fn base_prompt_includes_persona() {
        let setup = test_setup();
        let prompt = build_base_prompt(&setup);
        assert!(prompt.contains("You are a helpful coding assistant."));
    }

    #[test]
    fn base_prompt_without_persona() {
        let mut setup = test_setup();
        setup.persona = None;
        let prompt = build_base_prompt(&setup);
        assert!(!prompt.contains("helpful coding assistant"));
        assert!(prompt.contains("test-agent"));
    }

    #[test]
    fn capabilities_prompt_filters_by_allowlist() {
        let allowed = vec!["fs.read".into(), "fs.write".into()];
        let prompt = build_capabilities_prompt(&allowed, &[]);
        assert!(prompt.contains("fs.read"));
        assert!(prompt.contains("fs.write"));
        assert!(!prompt.contains("git.clone"));
    }

    #[test]
    fn capabilities_prompt_empty_allowlist() {
        let prompt = build_capabilities_prompt(&[], &[]);
        assert_eq!(prompt, "Your capabilities:\n");
    }

    #[test]
    #[allow(clippy::type_complexity)]
    fn capabilities_prompt_includes_extra_categories() {
        let allowed = vec!["custom.tool".into()];
        let extra: &[(&str, &str, &[(&str, &str)])] =
            &[("custom", "Custom Tools", &[("custom.tool", "does stuff")])];
        let prompt = build_capabilities_prompt(&allowed, extra);
        assert!(prompt.contains("Custom Tools"));
        assert!(prompt.contains("custom.tool"));
    }

    #[test]
    fn guidelines_prompt_not_empty() {
        let prompt = build_guidelines_prompt();
        assert!(prompt.contains("autonomous agent"));
        assert!(prompt.contains("Truthfulness"));
        assert!(prompt.contains("Action Commitment"));
    }

    #[test]
    fn hive_queen_prompt_contains_workflow() {
        let prompt = build_hive_queen_prompt();
        assert!(prompt.contains("hive.recruit"));
        assert!(prompt.contains("agent.spawn"));
        assert!(prompt.contains("Hive workflow"));
    }

    #[test]
    fn hive_worker_prompt_contains_workflow() {
        let prompt = build_hive_worker_prompt();
        assert!(prompt.contains("hive.task_list"));
        assert!(prompt.contains("hive.task_claim"));
    }

    #[test]
    fn stm_prompt_returns_empty_when_no_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        let prompt = build_stm_prompt(tmp.path());
        assert!(prompt.is_empty());
    }

    #[test]
    fn stm_prompt_returns_empty_for_empty_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("stm.yaml"), "").unwrap();
        let prompt = build_stm_prompt(tmp.path());
        assert!(prompt.is_empty());
    }

    #[test]
    fn stm_prompt_returns_empty_for_whitespace_only() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("stm.yaml"), "   \n  \n").unwrap();
        let prompt = build_stm_prompt(tmp.path());
        assert!(prompt.is_empty());
    }

    #[test]
    fn stm_prompt_injects_yaml_content() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join("stm.yaml"),
            "current_task: building auth\nstatus: in_progress\n",
        )
        .unwrap();
        let prompt = build_stm_prompt(tmp.path());
        assert!(prompt.contains("Short-Term Memory"));
        assert!(prompt.contains("current_task: building auth"));
        assert!(prompt.contains("status: in_progress"));
    }

    #[test]
    fn guidelines_prompt_mentions_stm() {
        let prompt = build_guidelines_prompt();
        assert!(prompt.contains("Short-Term Memory"));
        assert!(prompt.contains("automatically persisted"));
    }

    #[test]
    fn base_prompt_includes_template_before_persona() {
        let mut setup = test_setup();
        setup.template_content = Some("You are a Builder archetype.".into());
        setup.persona = Some("Custom persona instructions.".into());
        let prompt = build_base_prompt(&setup);
        let template_pos = prompt.find("Builder archetype").unwrap();
        let persona_pos = prompt.find("Custom persona instructions").unwrap();
        assert!(
            template_pos < persona_pos,
            "template should appear before persona"
        );
    }

    #[test]
    fn base_prompt_without_template() {
        let setup = test_setup();
        let prompt = build_base_prompt(&setup);
        assert!(!prompt.contains("Archetype"));
        assert!(prompt.contains("helpful coding assistant"));
    }

    #[test]
    fn template_prompt_wraps_content() {
        let prompt = build_template_prompt("You are a Builder.");
        assert!(prompt.contains("Agent Archetype"));
        assert!(prompt.contains("You are a Builder."));
    }
}
