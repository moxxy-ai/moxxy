use moxxy_runtime::{Message, ModelConfig, Provider};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct TaskAnalysis {
    pub needs_hive: bool,
    pub suggested_workers: u32,
    pub reasoning: String,
}

/// Classify whether a task needs hive swarm (multi-agent) or can be handled by a single agent.
/// Makes a single lightweight LLM call with a structured prompt.
/// Falls back to single-agent on any error.
pub async fn analyze_task_complexity(provider: &Arc<dyn Provider>, task: &str) -> TaskAnalysis {
    let prompt = format!(
        "Classify this task. Reply with EXACTLY one line in this format:\n\
         SINGLE | <reason>\n\
         or\n\
         HIVE <worker_count> | <reason>\n\n\
         Use HIVE only if the task explicitly requires multiple parallel workstreams \
         (e.g., \"build frontend and backend\", \"research 5 topics simultaneously\", \
         \"create multiple independent components\"). Most tasks are SINGLE.\n\n\
         Task: {task}"
    );

    let messages = vec![Message::user(prompt)];
    let config = ModelConfig {
        temperature: 0.0,
        max_tokens: 100,
    };

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        provider.complete(messages, &config, &[]),
    )
    .await;

    match result {
        Ok(Ok(response)) => parse_analysis(&response.content),
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "Task analysis LLM call failed, defaulting to single");
            TaskAnalysis {
                needs_hive: false,
                suggested_workers: 0,
                reasoning: "analysis failed".into(),
            }
        }
        Err(_) => {
            tracing::warn!("Task analysis timed out, defaulting to single");
            TaskAnalysis {
                needs_hive: false,
                suggested_workers: 0,
                reasoning: "timeout".into(),
            }
        }
    }
}

fn parse_analysis(content: &str) -> TaskAnalysis {
    let line = content.lines().next().unwrap_or("").trim();
    if line.starts_with("HIVE") {
        let parts: Vec<&str> = line.splitn(2, '|').collect();
        let hive_part = parts[0].trim();
        let reason = parts.get(1).map(|s| s.trim()).unwrap_or("").to_string();
        let workers: u32 = hive_part
            .split_whitespace()
            .nth(1)
            .and_then(|n| n.parse().ok())
            .unwrap_or(3)
            .min(8);
        TaskAnalysis {
            needs_hive: true,
            suggested_workers: workers,
            reasoning: reason,
        }
    } else {
        let reason = line
            .split_once('|')
            .map(|(_, s)| s.trim().to_string())
            .unwrap_or_default();
        TaskAnalysis {
            needs_hive: false,
            suggested_workers: 0,
            reasoning: reason,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_single_task() {
        let result = parse_analysis("SINGLE | simple task");
        assert!(!result.needs_hive);
        assert_eq!(result.suggested_workers, 0);
        assert_eq!(result.reasoning, "simple task");
    }

    #[test]
    fn parse_hive_with_workers() {
        let result = parse_analysis("HIVE 3 | needs parallel work");
        assert!(result.needs_hive);
        assert_eq!(result.suggested_workers, 3);
        assert_eq!(result.reasoning, "needs parallel work");
    }

    #[test]
    fn parse_hive_caps_at_eight() {
        let result = parse_analysis("HIVE 15 | many workers");
        assert!(result.needs_hive);
        assert_eq!(result.suggested_workers, 8);
        assert_eq!(result.reasoning, "many workers");
    }

    #[test]
    fn parse_hive_defaults_to_three() {
        let result = parse_analysis("HIVE | no count");
        assert!(result.needs_hive);
        assert_eq!(result.suggested_workers, 3);
        assert_eq!(result.reasoning, "no count");
    }

    #[test]
    fn parse_empty_input() {
        let result = parse_analysis("");
        assert!(!result.needs_hive);
        assert_eq!(result.suggested_workers, 0);
        assert!(result.reasoning.is_empty());
    }

    #[test]
    fn parse_malformed_input() {
        let result = parse_analysis("some random garbage response");
        assert!(!result.needs_hive);
        assert_eq!(result.suggested_workers, 0);
        assert!(result.reasoning.is_empty());
    }

    #[test]
    fn parse_single_without_pipe() {
        let result = parse_analysis("SINGLE");
        assert!(!result.needs_hive);
        assert_eq!(result.suggested_workers, 0);
        assert!(result.reasoning.is_empty());
    }

    #[test]
    fn parse_hive_without_pipe() {
        let result = parse_analysis("HIVE 5");
        assert!(result.needs_hive);
        assert_eq!(result.suggested_workers, 5);
        assert!(result.reasoning.is_empty());
    }
}
