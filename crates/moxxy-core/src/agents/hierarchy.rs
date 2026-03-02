use moxxy_types::SpawnError;

pub struct AgentLineage {
    pub root_agent_id: String,
    pub current_depth: u32,
    pub max_depth: u32,
    pub spawned_total: u32,
    pub max_total: u32,
}

impl AgentLineage {
    pub fn new(root_agent_id: &str, max_depth: u32, max_total: u32) -> Self {
        Self {
            root_agent_id: root_agent_id.to_string(),
            current_depth: 0,
            max_depth,
            spawned_total: 0,
            max_total,
        }
    }

    pub fn can_spawn(&self) -> bool {
        self.current_depth < self.max_depth && self.spawned_total < self.max_total
    }

    pub fn register_spawn(&mut self, _child_id: &str) -> Result<AgentLineage, SpawnError> {
        if self.current_depth >= self.max_depth {
            return Err(SpawnError::DepthLimitExceeded);
        }
        if self.spawned_total >= self.max_total {
            return Err(SpawnError::TotalLimitExceeded);
        }
        self.spawned_total += 1;
        Ok(AgentLineage {
            root_agent_id: self.root_agent_id.clone(),
            current_depth: self.current_depth + 1,
            max_depth: self.max_depth,
            spawned_total: 0,
            max_total: self.max_total,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn can_spawn_within_limits() {
        let lineage = AgentLineage::new("root-agent", 2, 8);
        assert!(lineage.can_spawn());
    }

    #[test]
    fn blocks_spawn_at_depth_limit() {
        let lineage = AgentLineage {
            root_agent_id: "root".into(),
            current_depth: 2,
            max_depth: 2,
            spawned_total: 0,
            max_total: 8,
        };
        assert!(!lineage.can_spawn());
    }

    #[test]
    fn blocks_spawn_at_total_limit() {
        let lineage = AgentLineage {
            root_agent_id: "root".into(),
            current_depth: 0,
            max_depth: 2,
            spawned_total: 8,
            max_total: 8,
        };
        assert!(!lineage.can_spawn());
    }

    #[test]
    fn register_spawn_increments_counters() {
        let mut lineage = AgentLineage::new("root", 2, 8);
        let child = lineage.register_spawn("child-1").unwrap();
        assert_eq!(child.current_depth, 1);
        assert_eq!(lineage.spawned_total, 1);
    }

    #[test]
    fn child_inherits_root_agent_id() {
        let mut lineage = AgentLineage::new("root-agent", 2, 8);
        let child = lineage.register_spawn("child-1").unwrap();
        assert_eq!(child.root_agent_id, "root-agent");
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn spawned_total_never_exceeds_max(max_total in 1u32..20u32, attempts in 1u32..30u32) {
            let mut lineage = AgentLineage::new("root", 100, max_total);
            let mut spawned = 0u32;
            for i in 0..attempts {
                if lineage.can_spawn() {
                    lineage.register_spawn(&format!("child-{}", i)).unwrap();
                    spawned += 1;
                }
            }
            prop_assert!(spawned <= max_total);
        }
    }
}
