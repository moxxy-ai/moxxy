#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Planning,
    PluginPreDispatch,
    Dispatching,
    Executing,
    Replanning,
    Reviewing,
    MergePending,
    Merging,
    Completed,
    Failed,
    Canceled,
}

impl JobState {
    pub fn as_str(self) -> &'static str {
        match self {
            JobState::Queued => "queued",
            JobState::Planning => "planning",
            JobState::PluginPreDispatch => "plugin_pre_dispatch",
            JobState::Dispatching => "dispatching",
            JobState::Executing => "executing",
            JobState::Replanning => "replanning",
            JobState::Reviewing => "reviewing",
            JobState::MergePending => "merge_pending",
            JobState::Merging => "merging",
            JobState::Completed => "completed",
            JobState::Failed => "failed",
            JobState::Canceled => "canceled",
        }
    }

    pub fn from_status(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(JobState::Queued),
            "planning" => Some(JobState::Planning),
            "plugin_pre_dispatch" => Some(JobState::PluginPreDispatch),
            "dispatching" => Some(JobState::Dispatching),
            "executing" => Some(JobState::Executing),
            "replanning" => Some(JobState::Replanning),
            "reviewing" => Some(JobState::Reviewing),
            "merge_pending" => Some(JobState::MergePending),
            "merging" => Some(JobState::Merging),
            "completed" => Some(JobState::Completed),
            "failed" => Some(JobState::Failed),
            "canceled" => Some(JobState::Canceled),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerMode {
    Existing,
    Ephemeral,
    Mixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobFailurePolicy {
    AutoReplan,
    FailFast,
    BestEffort,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobMergePolicy {
    ManualApproval,
    AutoOnReviewPass,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SpawnProfile {
    pub role: String,
    pub persona: String,
    pub provider: String,
    pub model: String,
    pub runtime_type: String,
    pub image_profile: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrchestratorTemplate {
    pub template_id: String,
    pub name: String,
    pub description: String,
    pub default_worker_mode: Option<WorkerMode>,
    pub default_max_parallelism: Option<usize>,
    pub default_retry_limit: Option<usize>,
    pub default_failure_policy: Option<JobFailurePolicy>,
    pub default_merge_policy: Option<JobMergePolicy>,
    pub spawn_profiles: Vec<SpawnProfile>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrchestratorAgentConfig {
    pub default_template_id: Option<String>,
    pub default_worker_mode: WorkerMode,
    pub default_max_parallelism: Option<usize>,
    pub default_retry_limit: usize,
    pub default_failure_policy: JobFailurePolicy,
    pub default_merge_policy: JobMergePolicy,
    pub parallelism_warn_threshold: usize,
}

impl Default for OrchestratorAgentConfig {
    fn default() -> Self {
        Self {
            default_template_id: None,
            default_worker_mode: WorkerMode::Mixed,
            default_max_parallelism: None,
            default_retry_limit: 1,
            default_failure_policy: JobFailurePolicy::AutoReplan,
            default_merge_policy: JobMergePolicy::ManualApproval,
            parallelism_warn_threshold: 5,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorkerAssignment {
    pub worker_mode: WorkerMode,
    pub worker_agent: String,
    pub role: String,
    pub persona: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub runtime_type: Option<String>,
    pub image_profile: Option<String>,
}

// --- Structured Task Graph types for orchestration ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct TaskContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files_to_create: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files_to_edit: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub build_commands: Vec<String>,
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub prior_outputs: std::collections::HashMap<String, String>,
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub extra: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TaskNode {
    pub task_id: String,
    pub role: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub context: TaskContext,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default = "default_task_status")]
    pub status: TaskStatus,
}

fn default_task_status() -> TaskStatus {
    TaskStatus::Pending
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TaskGraph {
    pub tasks: Vec<TaskNode>,
}
