//! Orchestrator job execution: runs workers and updates job state.
//!
//! Worker execution is split by agent kind:
//! - [native]: delegates to existing agents via registries
//! - [ephemeral]: creates task-scoped agents, runs, cleans up
//!
//! Task-graph model: planner produces a structured JSON task graph (or falls
//! back to markdown parsing). Workers run only when their dependencies are
//! satisfied (unlocked). Agents are spawned on-demand and despawned when their
//! task completes. No blocking—only ready tasks are delegated.

mod ephemeral;
mod native;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tokio::task::JoinSet;

use crate::core::orchestrator::{
    JobState, SpawnProfile, TaskGraph, TaskNode, TaskStatus, WorkerAssignment, WorkerMode,
    find_spawn_profile_by_role,
};
use crate::interfaces::web::AppState;

// --- Structured task graph parsing ---

/// Extract a JSON block from LLM output. Tries fenced ```json ... ``` first,
/// then raw JSON starting with `{` or `[`.
pub(crate) fn extract_json_block(text: &str) -> Option<&str> {
    let trimmed = text.trim();
    // Try fenced code block first
    if let Some(start) = trimmed.find("```json") {
        let content_start = start + 7;
        if let Some(end) = trimmed[content_start..].find("```") {
            let block = trimmed[content_start..content_start + end].trim();
            if !block.is_empty() {
                return Some(block);
            }
        }
    }
    // Try raw JSON (starts with { or [)
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Some(trimmed);
    }
    None
}

/// Parse planner output as a structured JSON task graph. Returns None if the
/// output is not valid JSON or does not contain a task graph.
pub(crate) fn parse_task_graph(planner_output: &str) -> Option<TaskGraph> {
    let json_str = extract_json_block(planner_output)?;
    serde_json::from_str::<TaskGraph>(json_str).ok()
}

/// Find all tasks in the graph that are ready to execute: status is Pending
/// and all dependencies are in the completed set.
pub(crate) fn ready_tasks<'a>(
    graph: &'a TaskGraph,
    completed: &HashSet<String>,
) -> Vec<&'a TaskNode> {
    graph
        .tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Pending)
        .filter(|t| t.depends_on.iter().all(|dep| completed.contains(dep)))
        .collect()
}

/// Build a rich prompt for a worker based on a structured TaskNode.
///
/// The prompt is structured so the agent focuses on its specific task only.
/// The full request is intentionally excluded to prevent agents from trying
/// to implement the entire project instead of just their assigned piece.
pub(crate) fn build_task_prompt(task: &TaskNode, _full_request: &str) -> String {
    let mut parts = Vec::new();

    parts.push(format!(
        "# YOUR TASK (task_id: {}): {}\n",
        task.task_id, task.title
    ));
    parts.push(format!("## Role: {}\n", task.role));
    parts.push(
        "## SCOPE\nYou are responsible for THIS TASK ONLY. Do NOT implement other parts of the project. \
         Other agents handle their own tasks in parallel.\n"
            .to_string(),
    );
    parts.push(format!("## Description\n{}\n", task.description));

    if let Some(ref repo) = task.context.repo {
        parts.push(format!("## Repository: {}\n", repo));
    }
    if let Some(ref branch) = task.context.branch {
        parts.push(format!("## Base branch: {}\n", branch));
    }
    if let Some(ref wt_branch) = task.context.worktree_branch {
        let repo_arg = task.context.repo.as_deref().unwrap_or("<repo>");
        let base_arg = task.context.branch.as_deref().unwrap_or("main");
        parts.push(format!(
            "## Worktree\nCreate or use a worktree with branch: {}\nUse: git ws init {} {} {}\n",
            wt_branch, repo_arg, base_arg, wt_branch
        ));
    }

    if !task.context.files_to_create.is_empty() {
        parts.push(format!(
            "## Files to create\n{}\n",
            task.context
                .files_to_create
                .iter()
                .map(|f| format!("- {}", f))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    if !task.context.files_to_edit.is_empty() {
        parts.push(format!(
            "## Files to edit\n{}\n",
            task.context
                .files_to_edit
                .iter()
                .map(|f| format!("- {}", f))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    if !task.context.build_commands.is_empty() {
        parts.push(format!(
            "## Build/test commands\n{}\n",
            task.context
                .build_commands
                .iter()
                .map(|c| format!("- `{}`", c))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }

    if !task.context.prior_outputs.is_empty() {
        parts.push("## Prior task outputs\n".to_string());
        for (tid, output) in &task.context.prior_outputs {
            parts.push(format!("[Task: {}]\n{}\n", tid, output));
        }
    }

    parts.join("\n")
}

// --- Legacy markdown planner parsing (backward compat) ---

/// Parse planner output for per-role task assignments. Supports:
/// - `## role\n<task>` (primary format)
/// - `### role\n<task>`
/// - `**role:**\n<task>` (fallback; no look-ahead in regex crate)
fn parse_planner_tasks(planner_output: &str) -> HashMap<String, String> {
    let mut tasks = HashMap::new();
    let text = planner_output.trim();
    if text.is_empty() {
        return tasks;
    }

    // Primary: ## role or ### role at line start (no look-ahead: find headers, extract content between)
    let re = regex::Regex::new(r"(?mi)^#+#\s*(\w+)\s*\n").unwrap();
    let runs: Vec<_> = re
        .captures_iter(text)
        .map(|cap| {
            let role = cap
                .get(1)
                .map(|m| m.as_str().to_lowercase())
                .unwrap_or_default();
            let range = cap.get(0).unwrap().range();
            (role, range)
        })
        .collect();

    for (i, (role, range)) in runs.iter().enumerate() {
        let content_start = range.end;
        let content_end = runs.get(i + 1).map(|(_, r)| r.start).unwrap_or(text.len());
        let task = text[content_start..content_end].trim();
        if !role.is_empty() && !task.is_empty() {
            tasks.insert(role.clone(), task.to_string());
        }
    }

    // If we got nothing, try **role:** on its own line (split by next **pattern**)
    if tasks.is_empty() {
        let re2 = regex::Regex::new(r"(?mi)^\*\*(\w+)\*\*:?\s*\n").unwrap();
        let runs2: Vec<_> = re2
            .captures_iter(text)
            .map(|cap| {
                let role = cap
                    .get(1)
                    .map(|m| m.as_str().to_lowercase())
                    .unwrap_or_default();
                let range = cap.get(0).unwrap().range();
                (role, range)
            })
            .collect();
        for (i, (role, range)) in runs2.iter().enumerate() {
            let content_start = range.end;
            let content_end = runs2.get(i + 1).map(|(_, r)| r.start).unwrap_or(text.len());
            let task = text[content_start..content_end].trim();
            if !role.is_empty() && !task.is_empty() {
                tasks.insert(role.clone(), task.to_string());
            }
        }
    }

    tasks
}

/// Build task list with deps: (role, deps). Each role depends on all prior roles.
/// Merger is appended when include_merger and not already present.
fn build_task_deps(
    assignments: &[WorkerAssignment],
    include_merger: bool,
) -> Vec<(String, Vec<String>)> {
    let roles: Vec<String> = assignments
        .iter()
        .filter(|a| !a.role.eq_ignore_ascii_case("planner"))
        .map(|a| a.role.to_lowercase())
        .collect();

    let mut tasks: Vec<(String, Vec<String>)> = roles
        .iter()
        .enumerate()
        .map(|(i, role)| {
            let deps: Vec<String> = roles[..i].to_vec();
            (role.clone(), deps)
        })
        .collect();

    if include_merger && !roles.iter().any(|r| r == "merger") {
        let prior: Vec<String> = roles.clone();
        tasks.push(("merger".to_string(), prior));
    }
    tasks
}

// --- Result types ---

/// Result of a completed orchestration job for the blocking API.
#[derive(Debug, Clone)]
pub struct JobResult {
    pub job_id: String,
    pub status: String,
    pub workers: Vec<WorkerResult>,
}

#[derive(Debug, Clone)]
pub struct WorkerResult {
    pub worker_agent: String,
    pub role: String,
    pub status: String,
    pub output: Option<String>,
}

/// Role-specific fallback when planner did not produce a task for this role.
fn fallback_task_for_role(role: &str) -> &'static str {
    match role.to_lowercase().as_str() {
        "builder" => {
            "Implement the full request. Create/update the necessary code and files. Use file_ops, git, workspace_shell etc. Output fork URL, branch name, and upstream repo when done."
        }
        "checker" => {
            "Validate the builder's implementation. Run tests, lint, and correctness checks. Use workspace_shell for tests, file_ops to inspect. Reply with exactly CHECKS_FAILED if validation fails, otherwise summarize what passed."
        }
        "merger" => {
            "Open a PR or merge based on prior outputs. Extract fork URL, branch, upstream from builder/checker outputs. Use git and github skills."
        }
        "worker" | "worker1" | "worker2" => "Execute the full request using available skills.",
        _ => "Execute your assigned role for the request below.",
    }
}

/// Build the phase prompt for a worker role (legacy markdown-based path).
fn build_phase_prompt(
    assignment: &WorkerAssignment,
    tasks_by_role: &HashMap<String, String>,
    prompt: &str,
    prior: &str,
    is_merger: bool,
    merge_action: Option<&str>,
) -> String {
    let role = &assignment.role;
    let assigned = tasks_by_role
        .get(role)
        .map(|t| t.as_str())
        .unwrap_or_else(|| fallback_task_for_role(role));
    let merge_str = merge_action.unwrap_or("pr_only");

    if is_merger {
        format!(
            "YOUR ASSIGNED TASK (role: merger):\n{}\n\nFULL REQUEST (context):\n{}\n\nMerge action: {}\n\nPrior phase outputs:\n{}",
            assigned, prompt, merge_str, prior
        )
    } else {
        format!(
            "YOUR ASSIGNED TASK (role: {}):\n{}\n\nFULL REQUEST (context):\n{}\n\nPrior phase outputs:\n{}",
            role, assigned, prompt, prior
        )
    }
}

/// Runs a single worker (native or ephemeral), records run in memory. Returns WorkerResult.
async fn run_single_worker(
    orchestrator_agent: &str,
    job_id: &str,
    assignment: &WorkerAssignment,
    phase_prompt: &str,
    mem_arc: &Arc<tokio::sync::Mutex<crate::core::memory::MemorySystem>>,
    state: &AppState,
) -> WorkerResult {
    let worker_mode_str = match assignment.worker_mode {
        crate::core::orchestrator::WorkerMode::Ephemeral => "ephemeral",
        crate::core::orchestrator::WorkerMode::Existing => "native",
        crate::core::orchestrator::WorkerMode::Mixed => "mixed",
    };

    let wr = match mem_arc
        .lock()
        .await
        .add_orchestrator_worker_run(
            job_id,
            &assignment.worker_agent,
            worker_mode_str,
            &format!("{} :: {}", assignment.role, phase_prompt),
            "running",
            1,
        )
        .await
    {
        Ok(r) => r,
        Err(_) => {
            return WorkerResult {
                worker_agent: assignment.worker_agent.clone(),
                role: assignment.role.clone(),
                status: "failed".to_string(),
                output: Some("Failed to record worker run".to_string()),
            };
        }
    };

    let _ = mem_arc
        .lock()
        .await
        .add_orchestrator_event(
            job_id,
            "worker_started",
            &serde_json::json!({
                "worker_run_id": wr.worker_run_id,
                "worker_agent": wr.worker_agent,
                "worker_mode": worker_mode_str,
            })
            .to_string(),
        )
        .await;

    let (status, output, error) = match assignment.worker_mode {
        crate::core::orchestrator::WorkerMode::Ephemeral => {
            ephemeral::execute(orchestrator_agent, job_id, assignment, phase_prompt, state).await
        }
        crate::core::orchestrator::WorkerMode::Existing => {
            native::execute(assignment, phase_prompt, state).await
        }
        crate::core::orchestrator::WorkerMode::Mixed => {
            // Mixed: treat as ephemeral for now
            ephemeral::execute(orchestrator_agent, job_id, assignment, phase_prompt, state).await
        }
    };

    let output_str = output.as_deref().or(error.as_deref());
    let _ = mem_arc
        .lock()
        .await
        .update_orchestrator_worker_run(&wr.worker_run_id, &status, output_str, error.as_deref())
        .await;

    let _ = mem_arc
        .lock()
        .await
        .add_orchestrator_event(
            job_id,
            "worker_completed",
            &serde_json::json!({
                "worker_run_id": wr.worker_run_id,
                "worker_agent": wr.worker_agent,
                "status": status,
            })
            .to_string(),
        )
        .await;

    WorkerResult {
        worker_agent: assignment.worker_agent.clone(),
        role: assignment.role.clone(),
        status,
        output: output.as_ref().or(error.as_ref()).cloned(),
    }
}

/// Convert agent execution result to worker result tuple.
/// Output is preserved up to 8000 chars to maintain context between phases.
pub(crate) fn to_worker_result(
    result: anyhow::Result<String>,
) -> (String, Option<String>, Option<String>) {
    match result {
        Ok(res) => {
            let summary = if res.len() > 8000 {
                format!("{}...", &res[..8000])
            } else {
                res
            };
            ("succeeded".to_string(), Some(summary), None)
        }
        Err(e) => ("failed".to_string(), None, Some(e.to_string())),
    }
}

/// Returns true if checker output implies job failure (CHECKS_FAILED gate).
fn checker_output_implies_failure(role: &str, output: Option<&str>) -> bool {
    if !role.eq_ignore_ascii_case("checker") {
        return false;
    }
    output.map(|o| o.contains("CHECKS_FAILED")).unwrap_or(false)
}

// --- Structured planner prompt ---

/// Build the planner prompt for structured JSON task graph output.
fn build_structured_planner_prompt(role_list: &[String], prompt: &str) -> String {
    let roles_str = role_list.join(", ");

    format!(
        "Analyze the REQUEST below and produce a task graph as JSON. Output ONLY valid JSON, no other text.\n\n\
         Available roles: {roles}\n\n\
         JSON schema (\"tasks\" array):\n\
         {{\n\
           \"tasks\": [\n\
             {{\n\
               \"task_id\": \"t1\",\n\
               \"role\": \"<one of: {roles}>\",\n\
               \"title\": \"<short descriptive title>\",\n\
               \"description\": \"<detailed, actionable description of what to implement or do>\",\n\
               \"context\": {{\n\
                 \"repo\": \"<owner/repo from the request, e.g. acme-corp/backend>\",\n\
                 \"branch\": \"<base branch, e.g. main>\",\n\
                 \"worktree_branch\": \"<new branch name for this task, e.g. feat/add-auth>\",\n\
                 \"files_to_create\": [\"<paths of new files>\"],\n\
                 \"files_to_edit\": [\"<paths of existing files to modify>\"],\n\
                 \"build_commands\": [\"<shell commands to build/test>\"]\n\
               }},\n\
               \"depends_on\": [],\n\
               \"status\": \"pending\"\n\
             }}\n\
           ]\n\
         }}\n\n\
         CRITICAL rules:\n\
         - Extract REAL repository names, branch names, and file paths from the REQUEST. Do NOT use placeholder values.\n\
         - Each task has a unique task_id (t1, t2, ...)\n\
         - Tasks with no dependencies can run in parallel\n\
         - Use depends_on to specify which task_ids must complete first\n\
         - Each task description must be specific and actionable with concrete file paths and code details\n\
         - The merger task (if present) should depend on all builder and checker tasks\n\
         - The builder task description should include the FULL implementation details (what code to write, what files to create)\n\n\
         REQUEST:\n{prompt}",
        roles = roles_str,
        prompt = prompt,
    )
}

/// Runs the orchestration job in the background. Updates job state and worker
/// runs via the orchestrator agent's memory. Optionally signals completion
/// via `done_tx` for the blocking `jobs run` API.
pub async fn run_orchestration_job(
    orchestrator_agent: String,
    job_id: String,
    prompt: String,
    worker_assignments: Vec<WorkerAssignment>,
    spawn_profiles: Vec<SpawnProfile>,
    merge_action: Option<String>,
    mem_arc: Arc<tokio::sync::Mutex<crate::core::memory::MemorySystem>>,
    state: AppState,
    done_tx: Option<tokio::sync::oneshot::Sender<JobResult>>,
) {
    let mut workers_result = Vec::new();
    let mut completed_roles: HashSet<String> = HashSet::new();
    let mut outputs_by_role: HashMap<String, String> = HashMap::new();
    let mut planner_output: Option<String> = None;

    // 1. Run planner first if present (it has no deps, produces task breakdown)
    let has_planner = worker_assignments
        .first()
        .map(|a| a.role.eq_ignore_ascii_case("planner"))
        .unwrap_or(false);

    let (assignments_without_planner, planner_failed, parsed_task_graph) = if has_planner {
        let planner = &worker_assignments[0];
        let role_list: Vec<_> = worker_assignments
            .iter()
            .skip(1)
            .map(|a| a.role.to_lowercase())
            .collect();

        // Use structured JSON planner prompt
        let planner_prompt = build_structured_planner_prompt(&role_list, &prompt);

        let wr = run_single_worker(
            &orchestrator_agent,
            &job_id,
            planner,
            &planner_prompt,
            &mem_arc,
            &state,
        )
        .await;
        workers_result.push(wr.clone());
        let out = wr.output.as_deref().unwrap_or("").to_string();
        planner_output = Some(out.clone());

        // Try structured JSON first, fall back to legacy markdown
        let task_graph = parse_task_graph(&out);

        let rest = worker_assignments[1..].to_vec();
        (rest, wr.status == "failed", task_graph)
    } else {
        (worker_assignments.clone(), false, None)
    };

    if !planner_failed {
        let include_merger = merge_action.as_ref().map_or(false, |a| {
            let lower = a.to_lowercase();
            !lower.is_empty() && lower != "none"
        });

        if let Some(mut task_graph) = parsed_task_graph {
            // === Structured task graph execution path ===

            // Persist all tasks from the parsed graph
            {
                let mem = mem_arc.lock().await;
                for task in &task_graph.tasks {
                    let _ = mem.create_orchestrator_task(&job_id, task).await;
                }
            }

            // Build assignment lookup by role
            let mut assignment_by_role: HashMap<String, WorkerAssignment> =
                assignments_without_planner
                    .iter()
                    .map(|a| (a.role.to_lowercase(), a.clone()))
                    .collect();

            if include_merger && !assignment_by_role.contains_key("merger") {
                let merger_profile = find_spawn_profile_by_role(&spawn_profiles, "merger");
                assignment_by_role.insert(
                    "merger".to_string(),
                    WorkerAssignment {
                        worker_mode: WorkerMode::Ephemeral,
                        worker_agent: format!(
                            "ephemeral-merger-{}",
                            workers_result.len() + 1
                        ),
                        role: "merger".to_string(),
                        persona: merger_profile
                            .map(|p| p.persona.clone())
                            .or_else(|| {
                                Some("You are a merger agent. Use github skill to open PR. Extract fork URL, branch, upstream from prior outputs.".to_string())
                            }),
                        provider: merger_profile.map(|p| p.provider.clone()),
                        model: merger_profile.map(|p| p.model.clone()),
                        runtime_type: merger_profile.map(|p| p.runtime_type.clone()),
                        image_profile: merger_profile.map(|p| p.image_profile.clone()),
                    },
                );
            }

            let mut completed_tasks: HashSet<String> = HashSet::new();
            let mut outputs_by_task: HashMap<String, String> = HashMap::new();
            let mut checker_failed = false;

            loop {
                let ready = ready_tasks(&task_graph, &completed_tasks);
                if ready.is_empty() {
                    break;
                }
                let ready_ids: Vec<String> = ready.iter().map(|t| t.task_id.clone()).collect();

                // Mark ready tasks as in_progress in DB
                {
                    let mem = mem_arc.lock().await;
                    for tid in &ready_ids {
                        let _ = mem
                            .update_orchestrator_task_status(tid, "in_progress", None, None, None)
                            .await;
                    }
                }

                let mut set = JoinSet::new();
                for task_id in &ready_ids {
                    let task = task_graph
                        .tasks
                        .iter()
                        .find(|t| &t.task_id == task_id)
                        .unwrap()
                        .clone();

                    // Inject prior outputs into task context
                    let mut enriched_task = task.clone();
                    for dep_id in &task.depends_on {
                        if let Some(output) = outputs_by_task.get(dep_id) {
                            enriched_task
                                .context
                                .prior_outputs
                                .insert(dep_id.clone(), output.clone());
                        }
                    }

                    let role = task.role.to_lowercase();
                    let Some(assignment) = assignment_by_role.get(&role).cloned() else {
                        // No assignment for this role — create ephemeral fallback
                        let profile = find_spawn_profile_by_role(&spawn_profiles, &role);
                        let fallback_assignment = WorkerAssignment {
                            worker_mode: WorkerMode::Ephemeral,
                            worker_agent: format!("ephemeral-{}", task_id),
                            role: role.clone(),
                            persona: profile.map(|p| p.persona.clone()),
                            provider: profile.map(|p| p.provider.clone()),
                            model: profile.map(|p| p.model.clone()),
                            runtime_type: profile.map(|p| p.runtime_type.clone()),
                            image_profile: profile.map(|p| p.image_profile.clone()),
                        };

                        let orchestrator_agent = orchestrator_agent.clone();
                        let job_id = job_id.clone();
                        let mem_arc = mem_arc.clone();
                        let state = state.clone();
                        let prompt = prompt.clone();
                        let tid = task_id.clone();
                        set.spawn(async move {
                            let phase_prompt = build_task_prompt(&enriched_task, &prompt);
                            let wr = run_single_worker(
                                &orchestrator_agent,
                                &job_id,
                                &fallback_assignment,
                                &phase_prompt,
                                &mem_arc,
                                &state,
                            )
                            .await;
                            (tid, wr)
                        });
                        continue;
                    };

                    let orchestrator_agent = orchestrator_agent.clone();
                    let job_id = job_id.clone();
                    let mem_arc = mem_arc.clone();
                    let state = state.clone();
                    let prompt = prompt.clone();
                    let tid = task_id.clone();
                    set.spawn(async move {
                        let phase_prompt = build_task_prompt(&enriched_task, &prompt);
                        let wr = run_single_worker(
                            &orchestrator_agent,
                            &job_id,
                            &assignment,
                            &phase_prompt,
                            &mem_arc,
                            &state,
                        )
                        .await;
                        (tid, wr)
                    });
                }

                while let Some(res) = set.join_next().await {
                    let (tid, wr) = match res {
                        Ok(r) => r,
                        Err(_e) => {
                            checker_failed = true;
                            break;
                        }
                    };
                    let out = wr.output.as_deref().unwrap_or("").to_string();
                    outputs_by_task.insert(tid.clone(), out.clone());
                    outputs_by_role.insert(wr.role.clone(), out.clone());
                    workers_result.push(wr.clone());

                    // Update task status in graph and persist to DB
                    let succeeded = wr.status == "succeeded";
                    let db_status = if succeeded { "succeeded" } else { "failed" };
                    if let Some(task) = task_graph.tasks.iter_mut().find(|t| t.task_id == tid) {
                        task.status = if succeeded {
                            TaskStatus::Succeeded
                        } else {
                            TaskStatus::Failed
                        };
                    }
                    {
                        let mem = mem_arc.lock().await;
                        let _ = mem
                            .update_orchestrator_task_status(
                                &tid,
                                db_status,
                                Some(&wr.worker_agent),
                                wr.output.as_deref(),
                                wr.output
                                    .as_ref()
                                    .filter(|_| !succeeded)
                                    .map(|s| s.as_str()),
                            )
                            .await;
                    }

                    // Only mark succeeded tasks as completed so downstream
                    // tasks that depend on them can run. Failed tasks stay
                    // unresolved, blocking their dependents.
                    if succeeded {
                        completed_tasks.insert(tid.clone());
                        completed_roles.insert(wr.role.clone());
                    }

                    if checker_output_implies_failure(&wr.role, wr.output.as_deref()) {
                        checker_failed = true;
                        break;
                    }
                }
                if checker_failed {
                    break;
                }
            }
        } else {
            // === Legacy markdown-based execution path ===
            let tasks_by_role = if let Some(ref out) = planner_output {
                parse_planner_tasks(out)
            } else {
                HashMap::new()
            };

            let task_graph = build_task_deps(&worker_assignments, include_merger);

            let mut assignment_by_role: HashMap<String, WorkerAssignment> =
                assignments_without_planner
                    .iter()
                    .map(|a| (a.role.to_lowercase(), a.clone()))
                    .collect();

            if include_merger && !assignment_by_role.contains_key("merger") {
                let merger_profile = find_spawn_profile_by_role(&spawn_profiles, "merger");
                assignment_by_role.insert(
                    "merger".to_string(),
                    WorkerAssignment {
                        worker_mode: WorkerMode::Ephemeral,
                        worker_agent: format!(
                            "ephemeral-merger-{}",
                            workers_result.len() + 1
                        ),
                        role: "merger".to_string(),
                        persona: merger_profile
                            .map(|p| p.persona.clone())
                            .or_else(|| {
                                Some("You are a merger agent. Use github skill to open PR. Extract fork URL, branch, upstream from prior outputs.".to_string())
                            }),
                        provider: merger_profile.map(|p| p.provider.clone()),
                        model: merger_profile.map(|p| p.model.clone()),
                        runtime_type: merger_profile.map(|p| p.runtime_type.clone()),
                        image_profile: merger_profile.map(|p| p.image_profile.clone()),
                    },
                );
            }

            let mut checker_failed = false;
            loop {
                let ready: Vec<String> = task_graph
                    .iter()
                    .filter(|(role, deps)| {
                        !completed_roles.contains(role.as_str())
                            && deps.iter().all(|d| completed_roles.contains(d.as_str()))
                    })
                    .map(|(role, _)| role.clone())
                    .collect();

                if ready.is_empty() {
                    break;
                }

                let prior: String = {
                    let mut parts = Vec::new();
                    if let Some(ref po) = planner_output {
                        parts.push(format!("[Planner]\n{}", po));
                    }
                    for (r, _) in task_graph
                        .iter()
                        .filter(|(r, _)| completed_roles.contains(r.as_str()))
                    {
                        if let Some(o) = outputs_by_role.get(r) {
                            parts.push(format!("[{}]\n{}", r, o));
                        }
                    }
                    parts.join("\n\n")
                };

                let mut set = JoinSet::new();
                for role in ready {
                    let Some(assignment) = assignment_by_role.get(&role).cloned() else {
                        continue;
                    };
                    let orchestrator_agent = orchestrator_agent.clone();
                    let job_id = job_id.clone();
                    let mem_arc = mem_arc.clone();
                    let state = state.clone();
                    let tasks_by_role = tasks_by_role.clone();
                    let prompt = prompt.clone();
                    let prior = prior.clone();
                    let merge_action = merge_action.clone();
                    let is_merger = include_merger && role == "merger";

                    set.spawn(async move {
                        let phase_prompt = build_phase_prompt(
                            &assignment,
                            &tasks_by_role,
                            &prompt,
                            &prior,
                            is_merger,
                            merge_action.as_deref(),
                        );
                        run_single_worker(
                            &orchestrator_agent,
                            &job_id,
                            &assignment,
                            &phase_prompt,
                            &mem_arc,
                            &state,
                        )
                        .await
                    });
                }

                while let Some(res) = set.join_next().await {
                    let wr = match res {
                        Ok(w) => w,
                        Err(_e) => {
                            checker_failed = true;
                            break;
                        }
                    };
                    let out = wr.output.as_deref().unwrap_or("").to_string();
                    completed_roles.insert(wr.role.clone());
                    outputs_by_role.insert(wr.role.clone(), out);
                    workers_result.push(wr.clone());
                    if checker_output_implies_failure(&wr.role, wr.output.as_deref()) {
                        checker_failed = true;
                        break;
                    }
                }
                if checker_failed {
                    break;
                }
            }
        }
    } // end if !planner_failed

    let checker_failed = workers_result
        .iter()
        .any(|w| checker_output_implies_failure(&w.role, w.output.as_deref()));

    let all_succeeded = workers_result.iter().all(|w| w.status == "succeeded");

    let (final_status, summary) = if checker_failed {
        (
            "failed".to_string(),
            Some("Checker reported CHECKS_FAILED".to_string()),
        )
    } else if all_succeeded {
        (
            "completed".to_string(),
            Some("Orchestration completed".to_string()),
        )
    } else {
        (
            "failed".to_string(),
            Some("One or more workers failed".to_string()),
        )
    };

    {
        let mem = mem_arc.lock().await;
        if let Ok(Some(current)) = mem.get_orchestrator_job(&job_id).await {
            let to = JobState::from_status(&final_status).unwrap_or(JobState::Failed);
            if let Some(from) = JobState::from_status(&current.status)
                && crate::core::orchestrator::can_transition(from, to)
            {
                let _ = mem
                    .update_orchestrator_job_status(&job_id, to.as_str(), summary.as_deref(), None)
                    .await;
            }
        }
    }

    let _ = mem_arc
        .lock()
        .await
        .add_orchestrator_event(
            &job_id,
            "done",
            &serde_json::json!({ "status": final_status }).to_string(),
        )
        .await;

    let result = JobResult {
        job_id: job_id.clone(),
        status: final_status,
        workers: workers_result,
    };

    if let Some(tx) = done_tx {
        let _ = tx.send(result);
    }
}
