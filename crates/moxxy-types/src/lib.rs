pub mod agents;
pub mod auth;
pub mod channels;
pub mod errors;
pub mod events;
pub mod heartbeat;
pub mod mcp;
pub mod media;
pub mod providers;
pub mod run_starter;
pub mod skills;
pub mod templates;
pub mod vault;
pub mod webhooks;

pub use agents::{AgentConfig, AgentRuntime, AgentStatus, AgentType, HiveRole, SpawnError};
pub use auth::{AuthMode, TokenError, TokenScope, TokenStatus};
pub use channels::{BindingStatus, ChannelError, ChannelStatus, ChannelType, MessageContent};
pub use errors::{PathPolicyError, StorageError};
pub use events::{EventEnvelope, EventType};
pub use heartbeat::{HeartbeatActionType, HeartbeatError};
pub use mcp::{McpConfig, McpServerConfig, McpToolDefinition, McpTransportType};
pub use media::{MediaAttachmentRef, MediaKind};
pub use providers::ProviderDocError;
pub use run_starter::{
    ChildInfo, RunOutcome, RunStarter, RunTrigger, SpawnOpts, SpawnResult, WorkspaceIsolation,
};
pub use skills::SkillDocError;
pub use templates::TemplateDocError;
pub use vault::VaultError;
pub use webhooks::WebhookDocError;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_scope_serializes_to_snake_case() {
        let scope = TokenScope::AgentsRead;
        let json = serde_json::to_string(&scope).unwrap();
        assert_eq!(json, "\"agents:read\"");
    }

    #[test]
    fn token_scope_round_trips_through_json() {
        let scopes = vec![
            TokenScope::AgentsRead,
            TokenScope::AgentsWrite,
            TokenScope::RunsWrite,
            TokenScope::VaultRead,
            TokenScope::VaultWrite,
            TokenScope::TokensAdmin,
            TokenScope::EventsRead,
            TokenScope::ChannelsRead,
            TokenScope::ChannelsWrite,
            TokenScope::SettingsRead,
            TokenScope::SettingsWrite,
            TokenScope::Wildcard,
        ];
        for scope in scopes {
            let json = serde_json::to_string(&scope).unwrap();
            let back: TokenScope = serde_json::from_str(&json).unwrap();
            assert_eq!(scope, back);
        }
    }

    #[test]
    fn settings_scopes_serialize_to_snake_case() {
        assert_eq!(
            serde_json::to_string(&TokenScope::SettingsRead).unwrap(),
            "\"settings:read\""
        );
        assert_eq!(
            serde_json::to_string(&TokenScope::SettingsWrite).unwrap(),
            "\"settings:write\""
        );
    }

    #[test]
    fn event_type_all_variants_count_matches_enum() {
        let all = EventType::all_variants();
        assert_eq!(all.len(), 69);
    }

    #[test]
    fn agent_status_default_is_idle() {
        let status = AgentStatus::default();
        assert_eq!(status, AgentStatus::Idle);
    }

    #[test]
    fn event_envelope_new_generates_uuid_and_timestamp() {
        let envelope = EventEnvelope::new(
            "agent-1".into(),
            Some("run-1".into()),
            None,
            1,
            EventType::RunStarted,
            serde_json::json!({}),
        );
        assert!(!envelope.event_id.is_empty());
        assert!(envelope.ts > 0);
    }

    #[test]
    fn heartbeat_action_type_serializes_correctly() {
        let action = HeartbeatActionType::NotifyCli;
        let json = serde_json::to_string(&action).unwrap();
        assert_eq!(json, "\"notify_cli\"");
    }

    #[test]
    fn auth_mode_default_is_loopback() {
        assert_eq!(AuthMode::default(), AuthMode::Loopback);
    }

    #[test]
    fn auth_mode_from_config_str() {
        assert_eq!(AuthMode::from_config_str("token"), AuthMode::Token);
        assert_eq!(AuthMode::from_config_str("loopback"), AuthMode::Loopback);
        assert_eq!(AuthMode::from_config_str("unknown"), AuthMode::Loopback);
    }

    #[test]
    fn auth_mode_is_loopback() {
        assert!(!AuthMode::Token.is_loopback());
        assert!(AuthMode::Loopback.is_loopback());
    }

    #[test]
    fn auth_mode_display() {
        assert_eq!(AuthMode::Token.to_string(), "token");
        assert_eq!(AuthMode::Loopback.to_string(), "loopback");
    }

    #[test]
    fn auth_mode_serializes_to_snake_case() {
        let json = serde_json::to_string(&AuthMode::Token).unwrap();
        assert_eq!(json, "\"token\"");
        let json = serde_json::to_string(&AuthMode::Loopback).unwrap();
        assert_eq!(json, "\"loopback\"");
    }

    #[test]
    fn auth_mode_round_trips_through_json() {
        for mode in [AuthMode::Token, AuthMode::Loopback] {
            let json = serde_json::to_string(&mode).unwrap();
            let back: AuthMode = serde_json::from_str(&json).unwrap();
            assert_eq!(mode, back);
        }
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    fn arb_token_scope() -> impl Strategy<Value = TokenScope> {
        prop_oneof![
            Just(TokenScope::AgentsRead),
            Just(TokenScope::AgentsWrite),
            Just(TokenScope::RunsWrite),
            Just(TokenScope::VaultRead),
            Just(TokenScope::VaultWrite),
            Just(TokenScope::TokensAdmin),
            Just(TokenScope::EventsRead),
            Just(TokenScope::ChannelsRead),
            Just(TokenScope::ChannelsWrite),
            Just(TokenScope::SettingsRead),
            Just(TokenScope::SettingsWrite),
            Just(TokenScope::Wildcard),
        ]
    }

    proptest! {
        #[test]
        fn all_token_scopes_round_trip(scope in arb_token_scope()) {
            let json = serde_json::to_string(&scope).unwrap();
            let back: TokenScope = serde_json::from_str(&json).unwrap();
            prop_assert_eq!(scope, back);
        }
    }

    fn arb_event_type() -> impl Strategy<Value = EventType> {
        prop_oneof![
            Just(EventType::RunStarted),
            Just(EventType::RunCompleted),
            Just(EventType::RunFailed),
            Just(EventType::MessageDelta),
            Just(EventType::MessageFinal),
            Just(EventType::ModelRequest),
            Just(EventType::ModelResponse),
            Just(EventType::SkillInvoked),
            Just(EventType::SkillCompleted),
            Just(EventType::SkillFailed),
            Just(EventType::PrimitiveInvoked),
            Just(EventType::PrimitiveCompleted),
            Just(EventType::PrimitiveFailed),
            Just(EventType::MemoryRead),
            Just(EventType::MemoryWrite),
            Just(EventType::VaultRequested),
            Just(EventType::VaultGranted),
            Just(EventType::VaultDenied),
            Just(EventType::HeartbeatTriggered),
            Just(EventType::HeartbeatCompleted),
            Just(EventType::HeartbeatFailed),
            Just(EventType::SubagentSpawned),
            Just(EventType::SubagentCompleted),
            Just(EventType::SecurityViolation),
            Just(EventType::SandboxDenied),
            Just(EventType::ChannelMessageReceived),
            Just(EventType::ChannelMessageSent),
            Just(EventType::ChannelError),
            Just(EventType::MemoryCompactStarted),
            Just(EventType::MemoryCompactCompleted),
            Just(EventType::UserAskQuestion),
            Just(EventType::UserAskAnswered),
            Just(EventType::SubagentAskQuestion),
            Just(EventType::SubagentFailed),
            Just(EventType::AgentAlive),
            Just(EventType::AgentStuck),
            Just(EventType::AgentNudged),
            Just(EventType::WebhookReceived),
            Just(EventType::WebhookActionCompleted),
            Just(EventType::WebhookActionFailed),
            Just(EventType::HiveCreated),
            Just(EventType::HiveDisbanded),
            Just(EventType::HiveMemberJoined),
            Just(EventType::HiveSignalPosted),
            Just(EventType::HiveTaskCompleted),
            Just(EventType::HiveTaskFailed),
            Just(EventType::HiveProposalCreated),
            Just(EventType::HiveProposalResolved),
            Just(EventType::HiveVoteCast),
            Just(EventType::HiveTaskCreated),
            Just(EventType::HiveTaskClaimed),
            Just(EventType::McpConnected),
            Just(EventType::McpDisconnected),
            Just(EventType::McpConnectionFailed),
            Just(EventType::McpToolInvoked),
            Just(EventType::McpToolCompleted),
            Just(EventType::McpToolFailed),
            Just(EventType::ReflectionStarted),
            Just(EventType::ReflectionCompleted),
            Just(EventType::ReflectionFailed),
            Just(EventType::SkillSynthesized),
            Just(EventType::SkillApprovalRequested),
            Just(EventType::SkillApproved),
            Just(EventType::SkillApprovalDenied),
            Just(EventType::SkillPatched),
            Just(EventType::RunQueued),
            Just(EventType::RunDequeued),
        ]
    }

    proptest! {
        #[test]
        fn all_event_types_serialize_as_dot_notation(et in arb_event_type()) {
            let json = serde_json::to_string(&et).unwrap();
            let s = json.trim_matches('"');
            prop_assert!(s.contains('.'), "EventType {:?} serialized as {} which lacks dot notation", et, s);
        }
    }
}
