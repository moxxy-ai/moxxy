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
    #[error("invalid cron expression: {0}")]
    InvalidCronExpr(String),
    #[error("invalid timezone: {0}")]
    InvalidTimezone(String),
    #[error("rule not found")]
    RuleNotFound,
    #[error("execution failed: {0}")]
    ExecutionFailed(String),
    #[error("file I/O error: {0}")]
    FileIo(String),
    #[error("parse error: {0}")]
    ParseError(String),
}
