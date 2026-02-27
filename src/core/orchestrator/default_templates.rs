//! Default orchestrator templates seeded on init.

use anyhow::Result;

use crate::core::memory::MemorySystem;
use crate::core::orchestrator::{
    JobFailurePolicy, JobMergePolicy, OrchestratorTemplate, SpawnProfile, WorkerMode,
};

fn default_profile(role: &str, persona: &str) -> SpawnProfile {
    SpawnProfile {
        role: role.to_string(),
        persona: persona.to_string(),
        provider: String::new(),
        model: String::new(),
        runtime_type: "native".to_string(),
        image_profile: "base".to_string(),
    }
}

// --- Template: Simple ---

fn simple_template() -> OrchestratorTemplate {
    OrchestratorTemplate {
        template_id: "simple".to_string(),
        name: "Simple".to_string(),
        description: "Single ephemeral worker for quick tasks. Good for exploring, one-off coding, or small workflows.".to_string(),
        default_worker_mode: Some(WorkerMode::Ephemeral),
        default_max_parallelism: Some(1),
        default_retry_limit: Some(1),
        default_failure_policy: Some(JobFailurePolicy::FailFast),
        default_merge_policy: None,
        spawn_profiles: vec![
            default_profile("worker", "You are a capable assistant. Execute the assigned task using available skills."),
        ],
    }
}

// --- Template: Builder-Checker-Merger ---

fn builder_checker_merger_template() -> OrchestratorTemplate {
    OrchestratorTemplate {
        template_id: "builder-checker-merger".to_string(),
        name: "Builder\u{2013}Checker\u{2013}Merger".to_string(),
        description: "Planner breaks down the request, then builder implements, checker validates (CHECKS_FAILED stops), merger opens PRs. Use with merge_action for full automation.".to_string(),
        default_worker_mode: Some(WorkerMode::Ephemeral),
        default_max_parallelism: Some(3),
        default_retry_limit: Some(1),
        default_failure_policy: Some(JobFailurePolicy::FailFast),
        default_merge_policy: Some(JobMergePolicy::ManualApproval),
        spawn_profiles: vec![
            default_profile("planner",
                "You are an orchestrator planner. Analyze the request and produce a structured JSON task graph. \
                 Output ONLY valid JSON with a \"tasks\" array. Each task has: task_id, role, title, description, \
                 context (repo, branch, worktree_branch, files_to_create, files_to_edit, build_commands), \
                 depends_on (task_ids), status (\"pending\"). Do NOT output any text outside the JSON."),
            default_profile("builder",
                "You are a builder agent. Work in an isolated git worktree. \
                 Create and edit files using file_ops, run builds with workspace_shell, and commit with git. \
                 Do NOT modify any skill definitions. \
                 When done, report the branch name, files changed, and build status."),
            default_profile("checker",
                "You are a code reviewer and validator. Inspect the builder's output, \
                 run tests with workspace_shell, check code quality with file_ops. \
                 If validation fails, output CHECKS_FAILED with details. \
                 Otherwise summarize what passed."),
            default_profile("merger",
                "You are a merge agent. Use git and github skills to push branches \
                 and open pull requests. Extract branch info from prior task outputs. \
                 Workflow: git ws use <branch>, git push, github pr."),
        ],
    }
}

// --- Template: Dev Pipeline ---

fn dev_pipeline_template() -> OrchestratorTemplate {
    OrchestratorTemplate {
        template_id: "dev-pipeline".to_string(),
        name: "Development Pipeline".to_string(),
        description:
            "Structured task graph pipeline. Planner produces JSON task graph with dependencies. \
            Workers execute tasks in parallel where possible, each in an isolated git worktree. \
            Checker validates. Merger opens PRs. Best for multi-file development projects."
                .to_string(),
        default_worker_mode: Some(WorkerMode::Ephemeral),
        default_max_parallelism: Some(4),
        default_retry_limit: Some(1),
        default_failure_policy: Some(JobFailurePolicy::FailFast),
        default_merge_policy: Some(JobMergePolicy::ManualApproval),
        spawn_profiles: vec![
            default_profile(
                "planner",
                "You are a development task planner. Given a project request, produce a structured JSON task graph. \
                 Output ONLY valid JSON\u{2014}no other text.\n\n\
                 Each task in the \"tasks\" array must have:\n\
                 - task_id: unique identifier (t1, t2, ...)\n\
                 - role: \"builder\", \"checker\", or \"merger\"\n\
                 - title: short descriptive title\n\
                 - description: detailed, actionable description of what to implement\n\
                 - context: { repo, branch, worktree_branch, files_to_create, files_to_edit, build_commands }\n\
                 - depends_on: array of task_ids that must complete first\n\
                 - status: \"pending\"\n\n\
                 Tasks with no dependencies run in parallel. The merger task should depend on all builder tasks. \
                 Be specific about which files to create/edit and what code to write.",
            ),
            default_profile(
                "builder",
                "You are a builder agent working in an isolated git worktree. Your job is to write code.\n\n\
                 WORKFLOW:\n\
                 1. Initialize worktree: git ws init <repo> <base_branch> <worktree_branch>\n\
                 2. Create/edit files using file_ops (write, patch)\n\
                 3. Build/test using workspace_shell\n\
                 4. Commit changes: git add, git commit\n\n\
                 IMPORTANT: Do NOT modify any skill definitions. Focus only on the assigned coding task.\n\
                 When done, report: branch name, files changed, build/test results.",
            ),
            default_profile(
                "checker",
                "You are a code review and validation agent.\n\n\
                 WORKFLOW:\n\
                 1. Switch to the builder's worktree: git ws use <branch>\n\
                 2. Read and review the code using file_ops\n\
                 3. Run tests and linters using workspace_shell\n\
                 4. Check for correctness, security issues, and code quality\n\n\
                 If ANY validation fails, output CHECKS_FAILED followed by details.\n\
                 Otherwise, summarize what was checked and what passed.",
            ),
            default_profile(
                "merger",
                "You are a merge and PR agent.\n\n\
                 WORKFLOW:\n\
                 1. Switch to the builder's worktree: git ws use <branch>\n\
                 2. Push the branch: git push\n\
                 3. Open a pull request: github pr <upstream_repo> <branch> <title>\n\n\
                 Extract repo, branch name, and upstream from prior task outputs.",
            ),
        ],
    }
}

// --- Template: Research & Report ---

fn research_report_template() -> OrchestratorTemplate {
    OrchestratorTemplate {
        template_id: "research-report".to_string(),
        name: "Research & Report".to_string(),
        description: "Two-phase pipeline: researcher gathers information (reads files, explores repos, searches), \
            then reporter synthesizes findings into a structured report. Good for codebase analysis, \
            architecture reviews, and documentation generation."
            .to_string(),
        default_worker_mode: Some(WorkerMode::Ephemeral),
        default_max_parallelism: Some(2),
        default_retry_limit: Some(1),
        default_failure_policy: Some(JobFailurePolicy::FailFast),
        default_merge_policy: None,
        spawn_profiles: vec![
            default_profile(
                "planner",
                "You are a research planner. Analyze the request and produce a structured JSON task graph. \
                 Output ONLY valid JSON. Create tasks with role \"researcher\" for gathering information \
                 and role \"reporter\" for synthesizing results. The reporter must depend on all researcher tasks. \
                 Multiple independent researcher tasks can run in parallel.",
            ),
            default_profile(
                "researcher",
                "You are a research agent. Your job is to gather information.\n\n\
                 WORKFLOW:\n\
                 1. Use git ws init to clone the target repo if needed\n\
                 2. Use file_ops to read and analyze code files\n\
                 3. Use workspace_shell to explore directory structures, run grep, etc.\n\
                 4. Use github to read issues, PRs, and repo metadata\n\n\
                 Report your findings in detail: file paths, code patterns, dependencies, architecture notes.",
            ),
            default_profile(
                "reporter",
                "You are a report writer. Synthesize the research findings from prior tasks into a clear, \
                 structured report. Use file_ops to write the report as a markdown file in the worktree. \
                 Include sections for: summary, key findings, recommendations, and references.",
            ),
        ],
    }
}

// --- Template: Multi-Repo ---

fn multi_repo_template() -> OrchestratorTemplate {
    OrchestratorTemplate {
        template_id: "multi-repo".to_string(),
        name: "Multi-Repo".to_string(),
        description: "Coordinate changes across multiple repositories. Planner creates tasks targeting \
            different repos. Each builder works in its own worktree. Merger opens PRs in each repo. \
            Ideal for cross-repo features, API changes, and monorepo-to-multirepo workflows."
            .to_string(),
        default_worker_mode: Some(WorkerMode::Ephemeral),
        default_max_parallelism: Some(6),
        default_retry_limit: Some(1),
        default_failure_policy: Some(JobFailurePolicy::BestEffort),
        default_merge_policy: Some(JobMergePolicy::ManualApproval),
        spawn_profiles: vec![
            default_profile(
                "planner",
                "You are a multi-repo orchestration planner. Given a request that spans multiple repositories, \
                 produce a structured JSON task graph. Output ONLY valid JSON.\n\n\
                 IMPORTANT: Set context.repo for each task to the specific repo (e.g. \"org/backend\", \"org/frontend\"). \
                 Tasks in different repos can run in parallel. Tasks in the same repo should have dependencies. \
                 Create separate builder tasks per repo, then checker per repo, then a final merger task per repo.",
            ),
            default_profile(
                "builder",
                "You are a builder agent for a specific repository. Your task specifies which repo to work in.\n\n\
                 WORKFLOW:\n\
                 1. Initialize worktree: git ws init <repo from context> <base_branch> <worktree_branch>\n\
                 2. Create/edit files using file_ops\n\
                 3. Build/test using workspace_shell\n\
                 4. Commit: git add, git commit\n\n\
                 Do NOT modify skill definitions. Report branch and changes when done.",
            ),
            default_profile(
                "checker",
                "You are a validation agent. Check the specific repo's changes.\n\n\
                 1. Switch to the worktree: git ws use <branch>\n\
                 2. Run tests and validation: workspace_shell\n\
                 3. If ANY check fails, output CHECKS_FAILED with details.\n\
                 Otherwise summarize what passed.",
            ),
            default_profile(
                "merger",
                "You are a merge agent. Open a PR for the specified repo.\n\n\
                 1. git ws use <branch>\n\
                 2. git push\n\
                 3. github pr <repo> <branch> <title>\n\n\
                 Extract repo and branch from your task context and prior outputs.",
            ),
        ],
    }
}

// --- Template: Parallel Workers ---

fn parallel_workers_template() -> OrchestratorTemplate {
    OrchestratorTemplate {
        template_id: "parallel-workers".to_string(),
        name: "Parallel Workers".to_string(),
        description: "Planner splits work into independent parallel tasks. All workers run simultaneously, \
            each in its own worktree. No checker/merger phase\u{2014}good for batch operations like \
            migrating files, updating configs, or applying the same change across multiple modules."
            .to_string(),
        default_worker_mode: Some(WorkerMode::Ephemeral),
        default_max_parallelism: Some(8),
        default_retry_limit: Some(1),
        default_failure_policy: Some(JobFailurePolicy::BestEffort),
        default_merge_policy: None,
        spawn_profiles: vec![
            default_profile(
                "planner",
                "You are a task splitter. Given a batch request, produce a structured JSON task graph. \
                 Output ONLY valid JSON.\n\n\
                 Split the work into independent tasks with role \"worker\". Each task should be self-contained \
                 and have NO dependencies (depends_on: []). This allows maximum parallelism. \
                 Include specific file paths and concrete instructions in each task description.",
            ),
            default_profile(
                "worker",
                "You are an independent worker agent. Execute your specific task.\n\n\
                 WORKFLOW:\n\
                 1. If working with a repo: git ws init <repo> <base> <branch>\n\
                 2. Create/edit files using file_ops\n\
                 3. Run any build/test commands using workspace_shell\n\
                 4. Commit if needed: git add, git commit\n\n\
                 Do NOT modify skill definitions. Report results when done.",
            ),
        ],
    }
}

/// Seed default orchestrator templates if none exist. Returns the number of templates added.
pub async fn seed_default_templates(memory: &MemorySystem) -> Result<usize> {
    let existing = memory.list_orchestrator_templates().await?;
    if !existing.is_empty() {
        return Ok(0);
    }

    let templates = [
        simple_template(),
        builder_checker_merger_template(),
        dev_pipeline_template(),
        research_report_template(),
        multi_repo_template(),
        parallel_workers_template(),
    ];

    for tpl in &templates {
        memory.upsert_orchestrator_template(tpl).await?;
    }

    Ok(templates.len())
}
