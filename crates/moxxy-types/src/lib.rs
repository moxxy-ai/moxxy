pub mod agents;
pub mod auth;
pub mod channels;
pub mod errors;
pub mod events;
pub mod heartbeat;
pub mod skills;
pub mod vault;

pub use agents::{AgentStatus, SpawnError};
pub use auth::{TokenError, TokenScope, TokenStatus};
pub use channels::{BindingStatus, ChannelError, ChannelStatus, ChannelType};
pub use errors::{PathPolicyError, StorageError};
pub use events::{EventEnvelope, EventType};
pub use heartbeat::{HeartbeatActionType, HeartbeatError};
pub use skills::{SkillDocError, SkillStatus};
pub use vault::VaultError;

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
        ];
        for scope in scopes {
            let json = serde_json::to_string(&scope).unwrap();
            let back: TokenScope = serde_json::from_str(&json).unwrap();
            assert_eq!(scope, back);
        }
    }

    #[test]
    fn event_type_has_all_30_variants() {
        let all = EventType::all_variants();
        assert_eq!(all.len(), 30);
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
    fn skill_status_variants_exist() {
        let _ = SkillStatus::Quarantined;
        let _ = SkillStatus::Approved;
        let _ = SkillStatus::Rejected;
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
