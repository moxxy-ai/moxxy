use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EventType {
    #[serde(rename = "run.started")]
    RunStarted,
    #[serde(rename = "run.completed")]
    RunCompleted,
    #[serde(rename = "run.failed")]
    RunFailed,
    #[serde(rename = "message.delta")]
    MessageDelta,
    #[serde(rename = "message.final")]
    MessageFinal,
    #[serde(rename = "model.request")]
    ModelRequest,
    #[serde(rename = "model.response")]
    ModelResponse,
    #[serde(rename = "skill.invoked")]
    SkillInvoked,
    #[serde(rename = "skill.completed")]
    SkillCompleted,
    #[serde(rename = "skill.failed")]
    SkillFailed,
    #[serde(rename = "primitive.invoked")]
    PrimitiveInvoked,
    #[serde(rename = "primitive.completed")]
    PrimitiveCompleted,
    #[serde(rename = "primitive.failed")]
    PrimitiveFailed,
    #[serde(rename = "memory.read")]
    MemoryRead,
    #[serde(rename = "memory.write")]
    MemoryWrite,
    #[serde(rename = "vault.requested")]
    VaultRequested,
    #[serde(rename = "vault.granted")]
    VaultGranted,
    #[serde(rename = "vault.denied")]
    VaultDenied,
    #[serde(rename = "heartbeat.triggered")]
    HeartbeatTriggered,
    #[serde(rename = "heartbeat.completed")]
    HeartbeatCompleted,
    #[serde(rename = "heartbeat.failed")]
    HeartbeatFailed,
    #[serde(rename = "subagent.spawned")]
    SubagentSpawned,
    #[serde(rename = "subagent.completed")]
    SubagentCompleted,
    #[serde(rename = "security.violation")]
    SecurityViolation,
    #[serde(rename = "sandbox.denied")]
    SandboxDenied,
    #[serde(rename = "channel.message_received")]
    ChannelMessageReceived,
    #[serde(rename = "channel.message_sent")]
    ChannelMessageSent,
    #[serde(rename = "channel.error")]
    ChannelError,
    #[serde(rename = "memory.compact_started")]
    MemoryCompactStarted,
    #[serde(rename = "memory.compact_completed")]
    MemoryCompactCompleted,
    #[serde(rename = "user.ask_question")]
    UserAskQuestion,
    #[serde(rename = "user.ask_answered")]
    UserAskAnswered,
    #[serde(rename = "subagent.ask_question")]
    SubagentAskQuestion,
    #[serde(rename = "subagent.failed")]
    SubagentFailed,
    #[serde(rename = "agent.alive")]
    AgentAlive,
    #[serde(rename = "agent.stuck")]
    AgentStuck,
    #[serde(rename = "webhook.received")]
    WebhookReceived,
    #[serde(rename = "hive.created")]
    HiveCreated,
    #[serde(rename = "hive.disbanded")]
    HiveDisbanded,
    #[serde(rename = "hive.member_joined")]
    HiveMemberJoined,
    #[serde(rename = "hive.signal_posted")]
    HiveSignalPosted,
    #[serde(rename = "hive.task_completed")]
    HiveTaskCompleted,
    #[serde(rename = "hive.proposal_created")]
    HiveProposalCreated,
    #[serde(rename = "hive.proposal_resolved")]
    HiveProposalResolved,
    #[serde(rename = "hive.vote_cast")]
    HiveVoteCast,
}

impl EventType {
    pub fn all_variants() -> Vec<EventType> {
        vec![
            EventType::RunStarted,
            EventType::RunCompleted,
            EventType::RunFailed,
            EventType::MessageDelta,
            EventType::MessageFinal,
            EventType::ModelRequest,
            EventType::ModelResponse,
            EventType::SkillInvoked,
            EventType::SkillCompleted,
            EventType::SkillFailed,
            EventType::PrimitiveInvoked,
            EventType::PrimitiveCompleted,
            EventType::PrimitiveFailed,
            EventType::MemoryRead,
            EventType::MemoryWrite,
            EventType::VaultRequested,
            EventType::VaultGranted,
            EventType::VaultDenied,
            EventType::HeartbeatTriggered,
            EventType::HeartbeatCompleted,
            EventType::HeartbeatFailed,
            EventType::SubagentSpawned,
            EventType::SubagentCompleted,
            EventType::SecurityViolation,
            EventType::SandboxDenied,
            EventType::ChannelMessageReceived,
            EventType::ChannelMessageSent,
            EventType::ChannelError,
            EventType::MemoryCompactStarted,
            EventType::MemoryCompactCompleted,
            EventType::UserAskQuestion,
            EventType::UserAskAnswered,
            EventType::SubagentAskQuestion,
            EventType::SubagentFailed,
            EventType::AgentAlive,
            EventType::AgentStuck,
            EventType::WebhookReceived,
            EventType::HiveCreated,
            EventType::HiveDisbanded,
            EventType::HiveMemberJoined,
            EventType::HiveSignalPosted,
            EventType::HiveTaskCompleted,
            EventType::HiveProposalCreated,
            EventType::HiveProposalResolved,
            EventType::HiveVoteCast,
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEnvelope {
    pub event_id: String,
    pub ts: i64,
    pub agent_id: String,
    pub run_id: Option<String>,
    pub parent_run_id: Option<String>,
    pub sequence: u64,
    pub event_type: EventType,
    pub payload: serde_json::Value,
    pub redactions: Vec<String>,
    pub sensitive: bool,
}

impl EventEnvelope {
    pub fn new(
        agent_id: String,
        run_id: Option<String>,
        parent_run_id: Option<String>,
        sequence: u64,
        event_type: EventType,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            event_id: uuid::Uuid::now_v7().to_string(),
            ts: chrono::Utc::now().timestamp_millis(),
            agent_id,
            run_id,
            parent_run_id,
            sequence,
            event_type,
            payload,
            redactions: Vec::new(),
            sensitive: false,
        }
    }
}
