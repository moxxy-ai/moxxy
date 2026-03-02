use moxxy_types::HeartbeatError;

pub struct HeartbeatRule {
    pub id: String,
    pub interval_minutes: i32,
    pub enabled: bool,
    pub next_run_at: String,
}

pub struct HeartbeatScheduler;

impl HeartbeatScheduler {
    pub fn validate_interval(minutes: i32) -> Result<(), HeartbeatError> {
        if minutes < 1 {
            return Err(HeartbeatError::InvalidInterval);
        }
        Ok(())
    }

    pub fn due_rules(
        rules: &[HeartbeatRule],
        now: chrono::DateTime<chrono::Utc>,
    ) -> Vec<&HeartbeatRule> {
        rules
            .iter()
            .filter(|r| {
                r.enabled && {
                    let next: chrono::DateTime<chrono::Utc> = r
                        .next_run_at
                        .parse()
                        .unwrap_or(now + chrono::Duration::hours(1));
                    next <= now
                }
            })
            .collect()
    }

    pub fn advance_next_run(
        current_next_run: &str,
        interval_minutes: i32,
        now: chrono::DateTime<chrono::Utc>,
    ) -> String {
        let mut next: chrono::DateTime<chrono::Utc> = current_next_run.parse().unwrap();
        let interval = chrono::Duration::minutes(interval_minutes as i64);
        while next <= now {
            next += interval;
        }
        next.to_rfc3339()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn zero_interval_rejected() {
        let result = HeartbeatScheduler::validate_interval(0);
        assert!(result.is_err());
    }

    #[test]
    fn returns_only_due_and_enabled_rules() {
        let now = Utc::now();
        let rules = vec![
            HeartbeatRule {
                id: "1".into(),
                interval_minutes: 5,
                enabled: true,
                next_run_at: (now - chrono::Duration::minutes(1)).to_rfc3339(),
            },
            HeartbeatRule {
                id: "2".into(),
                interval_minutes: 5,
                enabled: true,
                next_run_at: (now + chrono::Duration::minutes(10)).to_rfc3339(),
            },
            HeartbeatRule {
                id: "3".into(),
                interval_minutes: 5,
                enabled: false,
                next_run_at: (now - chrono::Duration::minutes(1)).to_rfc3339(),
            },
        ];
        let due = HeartbeatScheduler::due_rules(&rules, now);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, "1");
    }

    #[test]
    fn disabled_rules_never_returned() {
        let now = Utc::now();
        let rules = vec![HeartbeatRule {
            id: "1".into(),
            interval_minutes: 5,
            enabled: false,
            next_run_at: (now - chrono::Duration::hours(1)).to_rfc3339(),
        }];
        let due = HeartbeatScheduler::due_rules(&rules, now);
        assert!(due.is_empty());
    }

    #[test]
    fn advance_moves_next_run_past_now() {
        let now = Utc::now();
        let past = (now - chrono::Duration::minutes(3)).to_rfc3339();
        let next = HeartbeatScheduler::advance_next_run(&past, 5, now);
        let next_dt: chrono::DateTime<Utc> = next.parse().unwrap();
        assert!(next_dt > now);
    }

    #[test]
    fn advance_handles_missed_ticks_correctly() {
        let now = Utc::now();
        let past = (now - chrono::Duration::minutes(30)).to_rfc3339();
        let next = HeartbeatScheduler::advance_next_run(&past, 5, now);
        let next_dt: chrono::DateTime<Utc> = next.parse().unwrap();
        assert!(next_dt > now);
        assert!(next_dt <= now + chrono::Duration::minutes(5));
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn advance_always_produces_future_time(
            interval in 1i64..1440i64,
            missed_seconds in 0i64..86400i64,
        ) {
            let now = chrono::Utc::now();
            let past = (now - chrono::Duration::seconds(missed_seconds)).to_rfc3339();
            let next = HeartbeatScheduler::advance_next_run(&past, interval as i32, now);
            let next_dt: chrono::DateTime<chrono::Utc> = next.parse().unwrap();
            prop_assert!(next_dt > now);
        }
    }
}
