use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HeartbeatActionType {
    NotifyCli,
    NotifyWebhook,
    ExecuteSkill,
}

#[derive(Debug, thiserror::Error)]
pub enum HeartbeatError {
    #[error("invalid interval")]
    InvalidInterval,
    #[error("rule not found")]
    RuleNotFound,
    #[error("execution failed: {0}")]
    ExecutionFailed(String),
}
