//! Tests for structured task graph parsing, prompt building, and output truncation.

use std::collections::{HashMap, HashSet};

use crate::core::orchestrator::executor::{
    build_task_prompt, extract_json_block, parse_task_graph, ready_tasks, to_worker_result,
};
use crate::core::orchestrator::types::TaskContext;
use crate::core::orchestrator::{TaskGraph, TaskNode, TaskStatus};

// --- parse_task_graph tests ---

#[test]
fn parse_task_graph_valid_json() {
    let json = r#"{
        "tasks": [
            {
                "task_id": "t1",
                "role": "builder",
                "title": "Create API",
                "description": "Build REST API endpoints",
                "depends_on": [],
                "status": "pending"
            },
            {
                "task_id": "t2",
                "role": "checker",
                "title": "Run tests",
                "description": "Validate API endpoints",
                "depends_on": ["t1"],
                "status": "pending"
            }
        ]
    }"#;

    let graph = parse_task_graph(json).expect("should parse valid JSON task graph");
    assert_eq!(graph.tasks.len(), 2);
    assert_eq!(graph.tasks[0].task_id, "t1");
    assert_eq!(graph.tasks[0].role, "builder");
    assert_eq!(graph.tasks[1].depends_on, vec!["t1"]);
}

#[test]
fn parse_task_graph_fenced_code_block() {
    let output = "Here's the plan:\n```json\n{\"tasks\": [{\"task_id\": \"t1\", \"role\": \"builder\", \"title\": \"Build it\", \"description\": \"Do the work\", \"depends_on\": [], \"status\": \"pending\"}]}\n```\nDone.";

    let graph = parse_task_graph(output).expect("should parse fenced JSON block");
    assert_eq!(graph.tasks.len(), 1);
    assert_eq!(graph.tasks[0].task_id, "t1");
}

#[test]
fn parse_task_graph_invalid_input() {
    assert!(parse_task_graph("This is just plain text").is_none());
    assert!(parse_task_graph("").is_none());
    assert!(parse_task_graph("## builder\nDo stuff").is_none());
}

#[test]
fn parse_task_graph_with_context() {
    let json = r#"{
        "tasks": [{
            "task_id": "t1",
            "role": "builder",
            "title": "Setup project",
            "description": "Initialize the repo",
            "context": {
                "repo": "org/companion",
                "branch": "main",
                "worktree_branch": "feat/setup",
                "files_to_create": ["src/main.rs", "Cargo.toml"],
                "build_commands": ["cargo build"]
            },
            "depends_on": [],
            "status": "pending"
        }]
    }"#;

    let graph = parse_task_graph(json).unwrap();
    let ctx = &graph.tasks[0].context;
    assert_eq!(ctx.repo.as_deref(), Some("org/companion"));
    assert_eq!(ctx.branch.as_deref(), Some("main"));
    assert_eq!(ctx.files_to_create.len(), 2);
    assert_eq!(ctx.build_commands, vec!["cargo build"]);
}

// --- extract_json_block tests ---

#[test]
fn extract_json_block_fenced() {
    let text = "Preamble\n```json\n{\"key\": \"value\"}\n```\nPostamble";
    let block = extract_json_block(text).unwrap();
    assert_eq!(block, "{\"key\": \"value\"}");
}

#[test]
fn extract_json_block_raw_object() {
    let text = "{\"tasks\": []}";
    let block = extract_json_block(text).unwrap();
    assert_eq!(block, "{\"tasks\": []}");
}

#[test]
fn extract_json_block_raw_array() {
    let text = "[1, 2, 3]";
    let block = extract_json_block(text).unwrap();
    assert_eq!(block, "[1, 2, 3]");
}

#[test]
fn extract_json_block_none_for_text() {
    assert!(extract_json_block("Hello world").is_none());
    assert!(extract_json_block("").is_none());
}

// --- ready_tasks tests ---

#[test]
fn ready_tasks_no_deps_all_ready() {
    let graph = TaskGraph {
        tasks: vec![
            make_task("t1", "builder", &[], TaskStatus::Pending),
            make_task("t2", "checker", &[], TaskStatus::Pending),
        ],
    };
    let completed = HashSet::new();
    let ready = ready_tasks(&graph, &completed);
    assert_eq!(ready.len(), 2);
}

#[test]
fn ready_tasks_linear_deps() {
    let mut graph = TaskGraph {
        tasks: vec![
            make_task("t1", "builder", &[], TaskStatus::Pending),
            make_task("t2", "checker", &["t1"], TaskStatus::Pending),
            make_task("t3", "merger", &["t2"], TaskStatus::Pending),
        ],
    };

    // Nothing completed → only t1 ready
    let mut completed = HashSet::new();
    let ready = ready_tasks(&graph, &completed);
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].task_id, "t1");

    // t1 completed → t2 ready (mark t1 as Succeeded)
    completed.insert("t1".to_string());
    graph.tasks[0].status = TaskStatus::Succeeded;
    let ready = ready_tasks(&graph, &completed);
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].task_id, "t2");
}

#[test]
fn ready_tasks_diamond_deps() {
    let mut graph = TaskGraph {
        tasks: vec![
            make_task("t1", "builder1", &[], TaskStatus::Pending),
            make_task("t2", "builder2", &[], TaskStatus::Pending),
            make_task("t3", "merger", &["t1", "t2"], TaskStatus::Pending),
        ],
    };

    let mut completed = HashSet::new();
    let ready = ready_tasks(&graph, &completed);
    assert_eq!(ready.len(), 2); // t1 and t2

    // Only t1 done → t3 not yet ready
    completed.insert("t1".to_string());
    graph.tasks[0].status = TaskStatus::Succeeded;
    let ready = ready_tasks(&graph, &completed);
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].task_id, "t2");

    // Both done → t3 ready
    completed.insert("t2".to_string());
    graph.tasks[1].status = TaskStatus::Succeeded;
    let ready = ready_tasks(&graph, &completed);
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].task_id, "t3");
}

#[test]
fn ready_tasks_skips_non_pending() {
    let graph = TaskGraph {
        tasks: vec![
            make_task("t1", "builder", &[], TaskStatus::Succeeded),
            make_task("t2", "checker", &[], TaskStatus::InProgress),
            make_task("t3", "merger", &[], TaskStatus::Pending),
        ],
    };
    let completed = HashSet::new();
    let ready = ready_tasks(&graph, &completed);
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].task_id, "t3");
}

// --- build_task_prompt tests ---

#[test]
fn build_task_prompt_includes_all_context() {
    let task = TaskNode {
        task_id: "t1".to_string(),
        role: "builder".to_string(),
        title: "Create API endpoints".to_string(),
        description: "Build REST API for user management".to_string(),
        context: TaskContext {
            repo: Some("org/companion".to_string()),
            branch: Some("main".to_string()),
            worktree_branch: Some("feat/api".to_string()),
            files_to_create: vec!["src/api.rs".to_string()],
            files_to_edit: vec!["src/main.rs".to_string()],
            build_commands: vec!["cargo build".to_string()],
            prior_outputs: HashMap::new(),
            extra: HashMap::new(),
        },
        depends_on: vec![],
        status: TaskStatus::Pending,
    };

    let prompt = build_task_prompt(&task, "Build a companion app");

    assert!(prompt.contains("Create API endpoints"));
    assert!(prompt.contains("builder"));
    assert!(prompt.contains("Build REST API for user management"));
    assert!(prompt.contains("org/companion"));
    assert!(prompt.contains("main"));
    assert!(prompt.contains("feat/api"));
    // Worktree instruction should use actual repo/branch values, not placeholders
    assert!(prompt.contains("git ws init org/companion main feat/api"));
    assert!(prompt.contains("src/api.rs"));
    assert!(prompt.contains("src/main.rs"));
    assert!(prompt.contains("cargo build"));
    // Full request is intentionally excluded to prevent scope creep
    assert!(!prompt.contains("Build a companion app"));
    // Scope instruction is present
    assert!(prompt.contains("THIS TASK ONLY"));
    assert!(prompt.contains("task_id: t1"));
}

#[test]
fn build_task_prompt_omits_empty_fields() {
    let task = TaskNode {
        task_id: "t1".to_string(),
        role: "checker".to_string(),
        title: "Run tests".to_string(),
        description: "Validate everything".to_string(),
        context: TaskContext::default(),
        depends_on: vec![],
        status: TaskStatus::Pending,
    };

    let prompt = build_task_prompt(&task, "Check the code");

    assert!(prompt.contains("Run tests"));
    assert!(prompt.contains("Validate everything"));
    assert!(!prompt.contains("Repository"));
    assert!(!prompt.contains("Worktree"));
    assert!(!prompt.contains("Files to create"));
    assert!(!prompt.contains("Build/test"));
}

#[test]
fn build_task_prompt_includes_prior_outputs() {
    let mut prior = HashMap::new();
    prior.insert(
        "t0".to_string(),
        "Built src/api.rs successfully".to_string(),
    );

    let task = TaskNode {
        task_id: "t1".to_string(),
        role: "checker".to_string(),
        title: "Validate".to_string(),
        description: "Check builder output".to_string(),
        context: TaskContext {
            prior_outputs: prior,
            ..Default::default()
        },
        depends_on: vec!["t0".to_string()],
        status: TaskStatus::Pending,
    };

    let prompt = build_task_prompt(&task, "Build companion");
    assert!(prompt.contains("Built src/api.rs successfully"));
    assert!(prompt.contains("t0"));
}

// --- to_worker_result tests ---

#[test]
fn to_worker_result_preserves_output_up_to_limit() {
    let long_output = "x".repeat(7999);
    let (status, output, error) = to_worker_result(Ok(long_output.clone()));
    assert_eq!(status, "succeeded");
    assert_eq!(output.unwrap(), long_output);
    assert!(error.is_none());
}

#[test]
fn to_worker_result_truncates_above_limit() {
    let long_output = "x".repeat(9000);
    let (status, output, _) = to_worker_result(Ok(long_output));
    assert_eq!(status, "succeeded");
    let out = output.unwrap();
    assert!(out.len() < 9000);
    assert!(out.ends_with("..."));
}

#[test]
fn to_worker_result_handles_error() {
    let (status, output, error) = to_worker_result(Err(anyhow::anyhow!("boom")));
    assert_eq!(status, "failed");
    assert!(output.is_none());
    assert!(error.unwrap().contains("boom"));
}

// --- helpers ---

fn make_task(id: &str, role: &str, deps: &[&str], status: TaskStatus) -> TaskNode {
    TaskNode {
        task_id: id.to_string(),
        role: role.to_string(),
        title: format!("Task {}", id),
        description: format!("Description for {}", id),
        context: TaskContext::default(),
        depends_on: deps.iter().map(|s| s.to_string()).collect(),
        status,
    }
}
