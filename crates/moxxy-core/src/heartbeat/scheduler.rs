use std::str::FromStr;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use cron::Schedule;
use moxxy_types::HeartbeatError;

pub struct HeartbeatRule {
    pub id: String,
    pub interval_minutes: i32,
    pub enabled: bool,
    pub next_run_at: String,
    pub cron_expr: Option<String>,
    pub timezone: String,
}

pub struct HeartbeatScheduler;

impl HeartbeatScheduler {
    pub fn validate_interval(minutes: i32) -> Result<(), HeartbeatError> {
        if minutes < 1 {
            return Err(HeartbeatError::InvalidInterval);
        }
        Ok(())
    }

    pub fn validate_cron_expr(expr: &str) -> Result<(), HeartbeatError> {
        Schedule::from_str(expr).map_err(|e| HeartbeatError::InvalidCronExpr(e.to_string()))?;
        Ok(())
    }

    pub fn validate_timezone(tz: &str) -> Result<(), HeartbeatError> {
        tz.parse::<Tz>()
            .map_err(|_| HeartbeatError::InvalidTimezone(tz.to_string()))?;
        Ok(())
    }

    /// Compute the next run time from a cron expression in the given timezone.
    /// Returns the next occurrence after `after` as an RFC 3339 UTC string.
    pub fn compute_next_cron_run(
        cron_expr: &str,
        timezone: &str,
        after: DateTime<Utc>,
    ) -> Result<String, HeartbeatError> {
        let schedule = Schedule::from_str(cron_expr)
            .map_err(|e| HeartbeatError::InvalidCronExpr(e.to_string()))?;
        let tz: Tz = timezone
            .parse()
            .map_err(|_| HeartbeatError::InvalidTimezone(timezone.to_string()))?;
        let after_tz = after.with_timezone(&tz);
        schedule
            .after(&after_tz)
            .next()
            .map(|dt| dt.with_timezone(&Utc).to_rfc3339())
            .ok_or_else(|| HeartbeatError::InvalidCronExpr("no future occurrence".into()))
    }

    pub fn due_rules(rules: &[HeartbeatRule], now: DateTime<Utc>) -> Vec<&HeartbeatRule> {
        rules
            .iter()
            .filter(|r| {
                r.enabled && {
                    let next: DateTime<Utc> = r
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
        now: DateTime<Utc>,
    ) -> String {
        let mut next: DateTime<Utc> = current_next_run.parse().unwrap();
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
    use chrono::Timelike;

    fn rule(id: &str, interval: i32, enabled: bool, next_run_at: &str) -> HeartbeatRule {
        HeartbeatRule {
            id: id.into(),
            interval_minutes: interval,
            enabled,
            next_run_at: next_run_at.into(),
            cron_expr: None,
            timezone: "UTC".into(),
        }
    }

    #[test]
    fn zero_interval_rejected() {
        let result = HeartbeatScheduler::validate_interval(0);
        assert!(result.is_err());
    }

    #[test]
    fn returns_only_due_and_enabled_rules() {
        let now = Utc::now();
        let rules = vec![
            rule(
                "1",
                5,
                true,
                &(now - chrono::Duration::minutes(1)).to_rfc3339(),
            ),
            rule(
                "2",
                5,
                true,
                &(now + chrono::Duration::minutes(10)).to_rfc3339(),
            ),
            rule(
                "3",
                5,
                false,
                &(now - chrono::Duration::minutes(1)).to_rfc3339(),
            ),
        ];
        let due = HeartbeatScheduler::due_rules(&rules, now);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, "1");
    }

    #[test]
    fn disabled_rules_never_returned() {
        let now = Utc::now();
        let rules = vec![rule(
            "1",
            5,
            false,
            &(now - chrono::Duration::hours(1)).to_rfc3339(),
        )];
        let due = HeartbeatScheduler::due_rules(&rules, now);
        assert!(due.is_empty());
    }

    #[test]
    fn advance_moves_next_run_past_now() {
        let now = Utc::now();
        let past = (now - chrono::Duration::minutes(3)).to_rfc3339();
        let next = HeartbeatScheduler::advance_next_run(&past, 5, now);
        let next_dt: DateTime<Utc> = next.parse().unwrap();
        assert!(next_dt > now);
    }

    #[test]
    fn advance_handles_missed_ticks_correctly() {
        let now = Utc::now();
        let past = (now - chrono::Duration::minutes(30)).to_rfc3339();
        let next = HeartbeatScheduler::advance_next_run(&past, 5, now);
        let next_dt: DateTime<Utc> = next.parse().unwrap();
        assert!(next_dt > now);
        assert!(next_dt <= now + chrono::Duration::minutes(5));
    }

    #[test]
    fn validate_cron_expr_accepts_valid() {
        assert!(HeartbeatScheduler::validate_cron_expr("0 0 9 * * *").is_ok());
        assert!(HeartbeatScheduler::validate_cron_expr("0 30 */2 * * *").is_ok());
    }

    #[test]
    fn validate_cron_expr_rejects_invalid() {
        assert!(HeartbeatScheduler::validate_cron_expr("not a cron").is_err());
        assert!(HeartbeatScheduler::validate_cron_expr("").is_err());
    }

    #[test]
    fn validate_timezone_accepts_valid() {
        assert!(HeartbeatScheduler::validate_timezone("Europe/Warsaw").is_ok());
        assert!(HeartbeatScheduler::validate_timezone("UTC").is_ok());
        assert!(HeartbeatScheduler::validate_timezone("America/New_York").is_ok());
    }

    #[test]
    fn validate_timezone_rejects_invalid() {
        assert!(HeartbeatScheduler::validate_timezone("Not/A/Timezone").is_err());
    }

    #[test]
    fn cron_9am_cet_computes_correct_next_run() {
        // "0 0 9 * * *" = every day at 09:00:00
        // CET = Europe/Warsaw (UTC+1 in winter, UTC+2 in summer)
        let now: DateTime<Utc> = "2025-01-15T06:00:00Z".parse().unwrap(); // 07:00 CET
        let next =
            HeartbeatScheduler::compute_next_cron_run("0 0 9 * * *", "Europe/Warsaw", now).unwrap();
        let next_dt: DateTime<Utc> = next.parse().unwrap();
        // 9 AM CET in January = 8 AM UTC
        assert_eq!(next_dt.hour(), 8);
        assert_eq!(next_dt.minute(), 0);
        assert!(next_dt > now);
    }

    #[test]
    fn invalid_cron_expr_returns_error() {
        let now = Utc::now();
        let result = HeartbeatScheduler::compute_next_cron_run("bad cron", "UTC", now);
        assert!(result.is_err());
    }

    #[test]
    fn invalid_timezone_returns_error() {
        let now = Utc::now();
        let result = HeartbeatScheduler::compute_next_cron_run("0 0 9 * * *", "Fake/Zone", now);
        assert!(result.is_err());
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
