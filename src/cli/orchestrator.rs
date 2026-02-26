use anyhow::{Result, anyhow};
use reqwest::Client;
use tokio_stream::StreamExt;

use crate::core::terminal::{GuideSection, print_error, print_success};

pub async fn run_orchestrator_command(args: &[String]) -> Result<()> {
    let api_url = parse_api_url(args);
    let plan = build_request_plan(args)?;
    let client = Client::new();
    let url = format!("{}{}", api_url.trim_end_matches('/'), plan.path);

    if plan.stream {
        let resp = client.get(&url).send().await?;
        if !resp.status().is_success() {
            return Err(anyhow!("request failed with status {}", resp.status()));
        }

        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            let text = String::from_utf8_lossy(&chunk);
            for line in text.lines() {
                if let Some(event) = parse_stream_event(line) {
                    let event_type = event
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("event");
                    match event_type {
                        "advisory" => {
                            let msg = event
                                .get("text")
                                .and_then(|v| v.as_str())
                                .unwrap_or("advisory");
                            println!("[advisory] {}", msg);
                        }
                        "done" => {
                            print_success("orchestration stream finished");
                        }
                        _ => println!("{}", event),
                    }
                }
            }
        }

        return Ok(());
    }

    let request = match plan.method {
        HttpMethod::Get => client.get(&url),
        HttpMethod::Post => client.post(&url),
        HttpMethod::Patch => client.patch(&url),
        HttpMethod::Delete => client.delete(&url),
    };

    let request = if let Some(body) = &plan.body {
        request.json(body)
    } else {
        request
    };

    let resp = request.send().await?;
    let status = resp.status();
    let body = resp.json::<serde_json::Value>().await?;
    let ok = body
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(status.is_success());

    if ok {
        print_success("orchestrator request completed");
    } else {
        let message = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("request failed");
        print_error(message);
    }

    GuideSection::new("Orchestrator")
        .text(&serde_json::to_string_pretty(&body)?)
        .print();
    println!();

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HttpMethod {
    Get,
    Post,
    Patch,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RequestPlan {
    method: HttpMethod,
    path: String,
    body: Option<serde_json::Value>,
    stream: bool,
}

fn parse_api_url(args: &[String]) -> String {
    let mut api_url = "http://127.0.0.1:17890".to_string();
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--api-url" => {
                if i + 1 < args.len() {
                    api_url = args[i + 1].clone();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
    api_url
}

fn parse_agent(args: &[String]) -> String {
    let mut agent = "default".to_string();
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--agent" | "-a" => {
                if i + 1 < args.len() {
                    agent = args[i + 1].clone();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
    agent
}

fn parse_string_flag(args: &[String], flag: &str) -> Option<String> {
    let mut i = 2;
    while i < args.len() {
        if args[i] == flag {
            if i + 1 < args.len() {
                return Some(args[i + 1].clone());
            }
            return None;
        }
        i += 1;
    }
    None
}

fn parse_positional_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 4;
    while i < args.len() {
        match args[i].as_str() {
            "--agent" | "-a" | "--api-url" | "--json" | "--prompt" | "--template" | "--mode"
            | "--existing" | "--ephemeral" | "--max-parallelism" => {
                i += 2;
            }
            _ => {
                out.push(args[i].clone());
                i += 1;
            }
        }
    }
    out
}

fn parse_json_flag(args: &[String]) -> Result<Option<serde_json::Value>> {
    if let Some(raw) = parse_string_flag(args, "--json") {
        let parsed = serde_json::from_str(&raw)
            .map_err(|e| anyhow!("invalid JSON for --json payload: {}", e))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

fn build_request_plan(args: &[String]) -> Result<RequestPlan> {
    let (group, action) = parse_orchestrator_command(args)
        .ok_or_else(|| anyhow!("Usage: moxxy orchestrator <config|templates|jobs> <action>"))?;

    let agent = parse_agent(args);
    let base = format!("/api/agents/{}/orchestrate", agent);
    let positional = parse_positional_args(args);

    match group.as_str() {
        "config" => match action.as_str() {
            "get" => Ok(RequestPlan {
                method: HttpMethod::Get,
                path: format!("{}/config", base),
                body: None,
                stream: false,
            }),
            "set" => Ok(RequestPlan {
                method: HttpMethod::Post,
                path: format!("{}/config", base),
                body: Some(parse_json_flag(args)?.unwrap_or_else(|| serde_json::json!({}))),
                stream: false,
            }),
            _ => Err(anyhow!("Unsupported config action '{}'", action)),
        },
        "templates" | "template" => match action.as_str() {
            "list" | "ls" => Ok(RequestPlan {
                method: HttpMethod::Get,
                path: format!("{}/templates", base),
                body: None,
                stream: false,
            }),
            "create" | "set" | "upsert" => Ok(RequestPlan {
                method: HttpMethod::Post,
                path: format!("{}/templates", base),
                body: Some(
                    parse_json_flag(args)?
                        .ok_or_else(|| anyhow!("templates create requires --json payload"))?,
                ),
                stream: false,
            }),
            "get" => {
                let template_id = positional
                    .first()
                    .ok_or_else(|| anyhow!("templates get requires <template_id>"))?;
                Ok(RequestPlan {
                    method: HttpMethod::Get,
                    path: format!("{}/templates/{}", base, template_id),
                    body: None,
                    stream: false,
                })
            }
            "update" | "patch" => {
                let template_id = positional
                    .first()
                    .ok_or_else(|| anyhow!("templates update requires <template_id>"))?;
                Ok(RequestPlan {
                    method: HttpMethod::Patch,
                    path: format!("{}/templates/{}", base, template_id),
                    body: Some(parse_json_flag(args)?.unwrap_or_else(|| serde_json::json!({}))),
                    stream: false,
                })
            }
            "delete" | "remove" | "rm" => {
                let template_id = positional
                    .first()
                    .ok_or_else(|| anyhow!("templates delete requires <template_id>"))?;
                Ok(RequestPlan {
                    method: HttpMethod::Delete,
                    path: format!("{}/templates/{}", base, template_id),
                    body: None,
                    stream: false,
                })
            }
            _ => Err(anyhow!("Unsupported templates action '{}'", action)),
        },
        "jobs" | "job" => match action.as_str() {
            "start" => {
                let prompt = parse_string_flag(args, "--prompt")
                    .or_else(|| positional.first().cloned())
                    .ok_or_else(|| anyhow!("jobs start requires --prompt <text>"))?;

                let mut body = parse_json_flag(args)?.unwrap_or_else(|| serde_json::json!({}));
                if !body.is_object() {
                    return Err(anyhow!("--json payload must be a JSON object"));
                }
                let obj = body
                    .as_object_mut()
                    .ok_or_else(|| anyhow!("invalid payload object"))?;
                obj.insert("prompt".to_string(), serde_json::Value::String(prompt));

                if let Some(mode) = parse_string_flag(args, "--mode") {
                    obj.insert("worker_mode".to_string(), serde_json::Value::String(mode));
                }
                if let Some(template_id) = parse_string_flag(args, "--template") {
                    obj.insert(
                        "template_id".to_string(),
                        serde_json::Value::String(template_id),
                    );
                }
                if let Some(existing) = parse_string_flag(args, "--existing") {
                    let agents: Vec<serde_json::Value> = existing
                        .split(',')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(|s| serde_json::Value::String(s.to_string()))
                        .collect();
                    if !agents.is_empty() {
                        obj.insert(
                            "existing_agents".to_string(),
                            serde_json::Value::Array(agents),
                        );
                    }
                }
                if let Some(ephemeral) = parse_string_flag(args, "--ephemeral")
                    && let Ok(count) = ephemeral.parse::<usize>()
                {
                    obj.insert(
                        "ephemeral".to_string(),
                        serde_json::json!({ "count": count }),
                    );
                }
                if let Some(parallelism) = parse_string_flag(args, "--max-parallelism")
                    && let Ok(value) = parallelism.parse::<usize>()
                {
                    obj.insert("max_parallelism".to_string(), serde_json::json!(value));
                }

                Ok(RequestPlan {
                    method: HttpMethod::Post,
                    path: format!("{}/jobs", base),
                    body: Some(body),
                    stream: false,
                })
            }
            "status" | "get" => {
                let job_id = positional
                    .first()
                    .ok_or_else(|| anyhow!("jobs status requires <job_id>"))?;
                Ok(RequestPlan {
                    method: HttpMethod::Get,
                    path: format!("{}/jobs/{}", base, job_id),
                    body: None,
                    stream: false,
                })
            }
            "workers" => {
                let job_id = positional
                    .first()
                    .ok_or_else(|| anyhow!("jobs workers requires <job_id>"))?;
                Ok(RequestPlan {
                    method: HttpMethod::Get,
                    path: format!("{}/jobs/{}/workers", base, job_id),
                    body: None,
                    stream: false,
                })
            }
            "events" => {
                let job_id = positional
                    .first()
                    .ok_or_else(|| anyhow!("jobs events requires <job_id>"))?;
                Ok(RequestPlan {
                    method: HttpMethod::Get,
                    path: format!("{}/jobs/{}/events", base, job_id),
                    body: None,
                    stream: false,
                })
            }
            "stream" => {
                let job_id = positional
                    .first()
                    .ok_or_else(|| anyhow!("jobs stream requires <job_id>"))?;
                Ok(RequestPlan {
                    method: HttpMethod::Get,
                    path: format!("{}/jobs/{}/stream", base, job_id),
                    body: None,
                    stream: true,
                })
            }
            "cancel" => {
                let job_id = positional
                    .first()
                    .ok_or_else(|| anyhow!("jobs cancel requires <job_id>"))?;
                Ok(RequestPlan {
                    method: HttpMethod::Post,
                    path: format!("{}/jobs/{}/cancel", base, job_id),
                    body: None,
                    stream: false,
                })
            }
            "approve-merge" | "approve" => {
                let job_id = positional
                    .first()
                    .ok_or_else(|| anyhow!("jobs approve-merge requires <job_id>"))?;
                Ok(RequestPlan {
                    method: HttpMethod::Post,
                    path: format!("{}/jobs/{}/actions/approve-merge", base, job_id),
                    body: None,
                    stream: false,
                })
            }
            _ => Err(anyhow!("Unsupported jobs action '{}'", action)),
        },
        _ => Err(anyhow!("Unsupported group '{}'", group)),
    }
}

fn parse_orchestrator_command(args: &[String]) -> Option<(String, String)> {
    if args.len() < 4 {
        return None;
    }

    let mut group = args[2].to_lowercase();
    if group == "orchestrate" {
        group = "jobs".to_string();
    }
    Some((group, args[3].to_lowercase()))
}

fn parse_stream_event(line: &str) -> Option<serde_json::Value> {
    if !line.starts_with("data:") {
        return None;
    }
    let payload = line.trim_start_matches("data:").trim();
    serde_json::from_str(payload).ok()
}

#[cfg(test)]
fn parse_stream_event_type(line: &str) -> Option<String> {
    let payload = parse_stream_event(line)?;
    payload.get("type")?.as_str().map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        HttpMethod, build_request_plan, parse_orchestrator_command, parse_stream_event_type,
    };

    #[test]
    fn parses_templates_subcommand() {
        let args = vec![
            "moxxy".to_string(),
            "orchestrator".to_string(),
            "templates".to_string(),
            "list".to_string(),
        ];
        let parsed = parse_orchestrator_command(&args);
        assert_eq!(parsed, Some(("templates".to_string(), "list".to_string())));
    }

    #[test]
    fn parses_job_subcommand() {
        let args = vec![
            "moxxy".to_string(),
            "orchestrator".to_string(),
            "job".to_string(),
            "start".to_string(),
        ];
        let parsed = parse_orchestrator_command(&args);
        assert_eq!(parsed, Some(("job".to_string(), "start".to_string())));
    }

    #[test]
    fn maps_config_get_to_get_route() {
        let args = vec![
            "moxxy".to_string(),
            "orchestrator".to_string(),
            "config".to_string(),
            "get".to_string(),
            "--agent".to_string(),
            "default".to_string(),
        ];
        let plan = build_request_plan(&args).expect("plan");
        assert_eq!(plan.method, HttpMethod::Get);
        assert_eq!(plan.path, "/api/agents/default/orchestrate/config");
    }

    #[test]
    fn maps_template_patch_to_patch_route() {
        let args = vec![
            "moxxy".to_string(),
            "orchestrator".to_string(),
            "templates".to_string(),
            "update".to_string(),
            "tpl-kanban".to_string(),
            "--agent".to_string(),
            "default".to_string(),
        ];
        let plan = build_request_plan(&args).expect("plan");
        assert_eq!(plan.method, HttpMethod::Patch);
        assert_eq!(
            plan.path,
            "/api/agents/default/orchestrate/templates/tpl-kanban"
        );
    }

    #[test]
    fn maps_job_cancel_to_post_route() {
        let args = vec![
            "moxxy".to_string(),
            "orchestrator".to_string(),
            "jobs".to_string(),
            "cancel".to_string(),
            "job-1".to_string(),
            "--agent".to_string(),
            "default".to_string(),
        ];
        let plan = build_request_plan(&args).expect("plan");
        assert_eq!(plan.method, HttpMethod::Post);
        assert_eq!(
            plan.path,
            "/api/agents/default/orchestrate/jobs/job-1/cancel"
        );
    }

    #[test]
    fn parses_sse_advisory_event() {
        let line = r#"data: {"type":"advisory","text":"parallelism high"}"#;
        let ty = parse_stream_event_type(line);
        assert_eq!(ty.as_deref(), Some("advisory"));
    }
}
