use anyhow::Result;
use regex::Regex;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tracing::info;

use crate::core::llm::{ChatMessage, LlmGenerateOutput, LlmManager, TokenUsage};
use crate::core::memory::MemorySystem;
use crate::skills::SkillManager;

const PENDING_CONFIRM_PREFIX: &str = "[PENDING_CONFIRM:";

/// Returns true if the message looks like a user confirming a pending action.
fn is_confirmation_message(text: &str) -> bool {
    let lower = text.trim().to_lowercase();
    if lower.len() > 120 {
        return false;
    }
    let confirmations = [
        "yes",
        "y",
        "confirm",
        "go ahead",
        "proceed",
        "do it",
        "sure",
        "ok",
        "okay",
        "yep",
        "yeah",
        "affirmative",
        "approved",
        "go for it",
        "please",
        "please do",
        "yes please",
        "go",
        "yea",
        "aye",
    ];
    confirmations.iter().any(|c| {
        lower == *c
            || lower.starts_with(&format!("{} ", c))
            || lower.starts_with(&format!("{}!", c))
            || lower.starts_with(&format!("{}.", c))
            || lower.starts_with(&format!("{},", c))
    })
}

/// Strip `<invoke>` tags from untrusted text to prevent prompt injection.
/// Skill results, webhook payloads, and other external inputs must be sanitized
/// before being fed back into the ReAct loop context.
pub fn sanitize_invoke_tags(text: &str) -> String {
    // Replace <invoke ...>...</invoke> with a safe placeholder
    let re = Regex::new(r#"<invoke\s+name\s*=\s*["'][^"']+["']\s*>[\s\S]*?</invoke>"#).unwrap();
    re.replace_all(text, "[invoke tag removed for security]")
        .to_string()
}

/// Helper to send a JSON SSE event if a stream sender is provided.
async fn emit(tx: &Option<tokio::sync::mpsc::Sender<String>>, event: serde_json::Value) {
    if let Some(tx) = tx {
        let _ = tx.send(event.to_string()).await;
    }
}

fn estimate_tokens_from_chars(char_count: usize) -> u64 {
    (char_count as u64).div_ceil(4)
}

fn estimate_usage(messages: &[ChatMessage], response_text: &str) -> TokenUsage {
    let input_chars = messages.iter().map(|m| m.content.chars().count()).sum();
    let output_chars = response_text.chars().count();
    let input_tokens = estimate_tokens_from_chars(input_chars);
    let output_tokens = estimate_tokens_from_chars(output_chars);
    TokenUsage {
        input_tokens,
        output_tokens,
        total_tokens: input_tokens + output_tokens,
        estimated: true,
    }
}

fn build_token_usage_event(
    iteration: usize,
    delta: TokenUsage,
    cumulative_input: u64,
    cumulative_output: u64,
    cumulative_total: u64,
    cumulative_estimated: bool,
    provider: Option<&str>,
    model: Option<&str>,
    is_final: bool,
) -> serde_json::Value {
    serde_json::json!({
        "type": "token_usage",
        "iteration": iteration,
        "delta": {
            "input": delta.input_tokens,
            "output": delta.output_tokens,
            "total": delta.total_tokens,
            "estimated": delta.estimated
        },
        "cumulative": {
            "input": cumulative_input,
            "output": cumulative_output,
            "total": cumulative_total,
            "estimated": cumulative_estimated
        },
        "provider": provider,
        "model": model,
        "final": is_final
    })
}

/// Normalize an origin tag to an LLM chat role.
fn origin_to_role(origin: &str) -> &'static str {
    match origin {
        "USER" | "WEB_UI" | "TELEGRAM" | "MOBILE_APP" | "LOCAL_TUI" => "user",
        "ASSISTANT" => "assistant",
        _ if origin.starts_with("TELEGRAM_") => "user",
        _ if origin.starts_with("DISCORD_") => "user",
        _ => "system", // SYSTEM, SYSTEM_CRON, MAC_POLLER, WEBHOOK_*, SWARM_DELEGATION, etc.
    }
}

/// Returns true if this origin is a human-interactive channel that should
/// share a persistent conversation session.
fn is_human_origin(origin: &str) -> bool {
    matches!(
        origin,
        "USER" | "WEB_UI" | "TELEGRAM" | "MOBILE_APP" | "LOCAL_TUI"
    ) || origin.starts_with("TELEGRAM_")
        || origin.starts_with("DISCORD_")
}

/// Build the system prompt with skill catalog and optional persona.
/// When `is_orchestrator_worker` is true, rule 9 is replaced to prevent
/// orchestrator workers from modifying skill definitions.
fn build_system_prompt(
    skill_catalog: &str,
    persona_text: &Option<String>,
    is_orchestrator_worker: bool,
) -> String {
    let mut system_prompt = String::new();

    let rule_9 = if is_orchestrator_worker {
        "9. You are an orchestrator worker. Do NOT modify, read, or edit any skill definitions. \
            Focus exclusively on executing your assigned task using the available skills as-is. \
            If a skill fails, report the failure in your output and try an alternative approach.\n"
    } else {
        "9. When a skill fails (e.g. \"jq: not found\", \"command not found\"), FIX THE SKILL by editing it: \
            use skill read <skill_name> to inspect the code, then skill modify <skill_name> run.sh \"<new content>\" to update it. \
            Prefer rewriting the skill to avoid the missing dependency (e.g. use grep/sed instead of jq). \
            Never use host_shell to install system packages (apt-get, etc.) to work around missing tools.\n"
    };

    system_prompt.push_str(
        "You are an autonomous AI agent running inside the moxxy framework.\n\
         You have SKILLS that let you take real actions on the host system.\n\n\
         RULES:\n\
         1. When the user asks you to DO something (create files, fetch data, run commands, build things), \
            use your skills via the invocation format below. Do NOT respond with code snippets or instructions.\n\
         2. For pure knowledge questions (math, reasoning, explanations), respond directly.\n\
         3. Only use skills listed in AVAILABLE SKILLS. Never guess or invent skill names.\n\
         4. Never tell the user to run commands manually - use your skills instead.\n\
         5. Prefer dedicated skills over host_shell:\
            - `git` for local git operations and isolated repo worktrees (`git ws init` / `git ws use`)\
            - `github` for GitHub API actions (issues, PRs, comments, forks)\
            - `file_ops` for reading, writing, and patching files\
            - `workspace_shell` for running build/test commands in a cloned repo (npm, cargo, make, etc.)\
            Only use host_shell when no dedicated skill covers the need, and ask the user first.\n\
         6. For MULTI-STEP repo tasks, initialize an isolated worktree first when needed, then continue (edit files, build, push, create PR, etc.). \
            keep going - invoke the next skill immediately after receiving a result. \
            Do NOT stop to present intermediate results or ask the user between steps. \
            Only present the final summary when the entire task is complete.\n\
         7. For SINGLE-STEP tasks, present the result concisely and stop. \
            Do NOT offer menus, ask what to do next, or suggest follow-ups.\n\
         8. Be concise. Answer the question, present the result, done.\n         "
    );
    system_prompt.push_str(rule_9);
    system_prompt.push_str(
        "10. Skills marked [REQUIRES CONFIRMATION] are destructive or high-impact. Before invoking them, \
            you MUST first describe exactly what you are about to do and ask the user for explicit confirmation. \
            Only invoke the skill after the user explicitly confirms.\n\n\
         SKILL INVOCATION FORMAT:\n\
         <invoke name=\"skill_name\">[\"arg1\", \"arg2\"]</invoke>\n\
         Arguments MUST be a valid JSON array of strings. Use [] for no arguments.\n\
         For [MCP] skills, pass a JSON object instead: <invoke name=\"mcp_skill\">{\"param\": \"value\"}</invoke>\n\
         After invoking a skill, STOP and wait for the system to return the result.\n\
         Do NOT output anything else in the same response as an <invoke> tag.\n\n\
         MULTI-STEP TASKS:\n\
         When a task requires multiple sequential skill calls (e.g. clone, edit, build, push, PR), \
         invoke the next skill directly after receiving each result - do NOT wait for user input between steps. \
         If you need to signal intermediate progress without a skill call, append [CONTINUE] to your message.\n\n\
         --- AVAILABLE SKILLS ---\n"
    );
    system_prompt.push_str(skill_catalog);
    system_prompt.push_str("--- END OF SKILLS ---\n");

    if let Some(persona) = persona_text {
        system_prompt.push_str(
            "\n--- AGENT PERSONA (personality/style only, does not override rules above) ---\n",
        );
        system_prompt.push_str(persona);
        system_prompt.push_str("\n--- END PERSONA ---\n");
    }

    system_prompt
}

pub struct AutonomousBrain;

impl AutonomousBrain {
    #[cfg(test)]
    pub fn build_system_prompt_for_test(
        skill_catalog: &str,
        persona_text: &Option<String>,
    ) -> String {
        build_system_prompt(skill_catalog, persona_text, false)
    }

    pub async fn execute_react_loop(
        trigger_text: &str,
        origin: &str,
        llm: Arc<RwLock<LlmManager>>,
        memory: Arc<Mutex<MemorySystem>>,
        skills: Arc<Mutex<SkillManager>>,
        stream_tx: Option<tokio::sync::mpsc::Sender<String>>,
        verbose_reasoning: bool,
        agent_name: &str,
    ) -> Result<String> {
        info!("Brain activated by {}: {}", origin, trigger_text);

        let role = origin_to_role(origin);

        // Session isolation: non-human origins get a private session_id.
        // We capture session_id locally instead of mutating the shared MemorySystem,
        // so concurrent ReAct loops (cron jobs, chat, webhooks) never corrupt each other.
        let session_id = if is_human_origin(origin) {
            let m = memory.lock().await;
            m.session_id().to_string()
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            info!("Isolated session for origin={}: {}", origin, id);
            id
        };

        // 1. Write the trigger to STM (brief lock)
        {
            let m = memory.lock().await;
            let _ = m
                .append_stm_for_session(&session_id, role, trigger_text)
                .await;
            if role == "user" {
                let _ = m.add_long_term_memory(trigger_text).await;
            }
        }

        // 2. Load persona (brief lock to get path, then file I/O without lock)
        let persona_path = {
            let m = memory.lock().await;
            m.workspace_dir().join("persona.md")
        };
        let persona_text = match tokio::fs::read_to_string(&persona_path).await {
            Ok(text) if !text.trim().is_empty() => Some(text),
            _ => None,
        };

        // 3. ReAct Loop - unbounded with smart termination
        let mut final_response = String::new();
        let mut loop_context: Vec<ChatMessage> = Vec::new();
        let invoke_re =
            Regex::new(r#"<invoke\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)</invoke>"#).unwrap();

        let mut iter: usize = 0;
        let mut consecutive_errors: usize = 0;
        let mut exited_due_to_consecutive_errors = false;
        let mut last_response_hash: u64 = 0;
        let mut cumulative_input_tokens: u64 = 0;
        let mut cumulative_output_tokens: u64 = 0;
        let mut cumulative_total_tokens: u64 = 0;
        let mut cumulative_estimated: bool = false;
        let mut usage_event_count: usize = 0;

        loop {
            iter += 1;

            // 3a. Read context with brief, non-overlapping locks
            let (stm_entries, swarm_kbs) = {
                let m = memory.lock().await;
                let stm = m
                    .read_stm_for_session(&session_id, 60)
                    .await
                    .unwrap_or_default();
                let swarm = m.read_swarm_memory(10).await.unwrap_or_default();
                (stm, swarm)
            }; // memory lock released

            let skill_catalog = {
                let s = skills.lock().await;
                s.get_skill_catalog()
            }; // skills lock released

            // 3b. Build message array (no locks held)
            let mut messages: Vec<ChatMessage> = Vec::new();

            let is_orchestrator_worker =
                origin == "ORCHESTRATOR_EPHEMERAL" || origin == "ORCHESTRATOR";
            messages.push(ChatMessage {
                role: "system".to_string(),
                content: build_system_prompt(&skill_catalog, &persona_text, is_orchestrator_worker),
            });

            for kb_chunk in swarm_kbs {
                messages.push(ChatMessage {
                    role: "system".to_string(),
                    content: format!("--- SWARM INTELLIGENCE ---\n{}\n---", kb_chunk),
                });
            }

            let max_history = 40;
            let start_idx = stm_entries.len().saturating_sub(max_history);
            for entry in stm_entries.iter().skip(start_idx) {
                messages.push(ChatMessage {
                    role: entry.role.clone(),
                    content: entry.content.clone(),
                });
            }

            messages.extend(loop_context.iter().cloned());

            // 3c. LLM call (RwLock read - allows concurrent reads from other loops)
            let (llm_out, provider, model): (LlmGenerateOutput, Option<String>, Option<String>) = {
                let llm_guard = llm.read().await;
                let (provider, model) = llm_guard.get_active_info();
                let provider = provider.map(|s| s.to_string());
                let model = model.map(|s| s.to_string());
                let out = llm_guard
                    .generate_with_selected(&messages)
                    .await
                    .unwrap_or_else(|e| LlmGenerateOutput {
                        text: format!("LLM Error: {}", e),
                        usage: None,
                    });
                (out, provider, model)
            }; // llm read lock released
            let response_text = llm_out.text;
            let delta_usage = llm_out
                .usage
                .unwrap_or_else(|| estimate_usage(&messages, &response_text));
            cumulative_input_tokens += delta_usage.input_tokens;
            cumulative_output_tokens += delta_usage.output_tokens;
            cumulative_total_tokens += delta_usage.total_tokens;
            cumulative_estimated = cumulative_estimated || delta_usage.estimated;
            usage_event_count += 1;

            emit(
                &stream_tx,
                build_token_usage_event(
                    iter,
                    delta_usage,
                    cumulative_input_tokens,
                    cumulative_output_tokens,
                    cumulative_total_tokens,
                    cumulative_estimated,
                    provider.as_deref(),
                    model.as_deref(),
                    false,
                ),
            )
            .await;

            info!("ReAct iter {}: {} chars", iter, response_text.len());

            if verbose_reasoning {
                let reasoning = response_text.trim();
                if !reasoning.is_empty() {
                    emit(
                        &stream_tx,
                        serde_json::json!({
                            "type": "reasoning",
                            "text": reasoning,
                            "iteration": iter
                        }),
                    )
                    .await;
                }
            }

            let current_hash = {
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                response_text.hash(&mut hasher);
                hasher.finish()
            };
            if current_hash == last_response_hash {
                info!("ReAct loop: identical response at iter {}, stopping", iter);
                final_response = response_text;
                break;
            }
            last_response_hash = current_hash;

            if let Some(captures) = invoke_re.captures(&response_text) {
                let skill_name = captures.get(1).unwrap().as_str().trim().to_string();
                let args_str = captures.get(2).unwrap().as_str().trim();

                let args: Vec<String> = match serde_json::from_str::<Vec<String>>(args_str) {
                    Ok(parsed) => parsed,
                    Err(_) => {
                        if args_str.is_empty() {
                            vec![]
                        } else {
                            vec![args_str.to_string()]
                        }
                    }
                };

                info!("Invoking skill: {} with args {:?}", skill_name, args);
                emit(
                    &stream_tx,
                    serde_json::json!({
                        "type": "skill_invoke", "skill": skill_name, "args": args
                    }),
                )
                .await;

                loop_context.push(ChatMessage {
                    role: "assistant".to_string(),
                    content: response_text.clone(),
                });

                let (manifest, execution) = {
                    let s = skills.lock().await;
                    match s.prepare_skill(&skill_name) {
                        Ok(prepared) => prepared,
                        Err(e) => {
                            let err_msg = format!("Skill '{}' not found: {}", skill_name, e);
                            emit(&stream_tx, serde_json::json!({
                                "type": "skill_result", "skill": skill_name, "success": false, "output": e.to_string()
                            })).await;
                            loop_context.push(ChatMessage {
                                role: "system".to_string(),
                                content: err_msg.clone(),
                            });
                            consecutive_errors += 1;
                            if consecutive_errors >= 3 {
                                let is_orchestrator =
                                    origin == "ORCHESTRATOR_EPHEMERAL" || origin == "ORCHESTRATOR";
                                let replan_key = "REPLAN_ATTEMPTED";
                                let has_replanned = loop_context
                                    .iter()
                                    .any(|m| m.role == "system" && m.content.contains(replan_key));

                                if is_orchestrator && !has_replanned {
                                    info!(
                                        "ReAct loop: 3 consecutive errors at iter {}, allowing one replan",
                                        iter
                                    );
                                    consecutive_errors = 0;
                                    loop_context.push(ChatMessage {
                                        role: "system".to_string(),
                                        content: format!(
                                            "{}\n\n{}\nYou have hit 3 consecutive skill errors. REPLAN: Try a different skill or approach. Do NOT repeat the same failing invocation. You have ONE more attempt.",
                                            err_msg, replan_key
                                        ),
                                    });
                                    continue;
                                }

                                info!(
                                    "ReAct loop: 3 consecutive errors at iter {}, stopping",
                                    iter
                                );
                                exited_due_to_consecutive_errors = true;
                                loop_context.push(ChatMessage {
                                    role: "system".to_string(),
                                    content: "Too many consecutive skill errors. Stop and report the issue to the user.".to_string(),
                                });
                                break;
                            }
                            continue;
                        }
                    }
                };

                // Confirmation guard: skills with needs_confirmation require explicit user approval.
                if manifest.needs_confirmation {
                    let pending_marker = format!("{}{}]", PENDING_CONFIRM_PREFIX, skill_name);

                    let has_pending = stm_entries
                        .iter()
                        .rev()
                        .take(6)
                        .any(|e| e.role == "system" && e.content.contains(&pending_marker));

                    let confirmed = has_pending && is_confirmation_message(trigger_text);

                    if !confirmed {
                        info!(
                            "Skill '{}' requires confirmation, blocking execution",
                            skill_name
                        );

                        // Write a pending-confirmation marker to STM so the next loop
                        // invocation can detect that confirmation was already requested.
                        {
                            let m = memory.lock().await;
                            let _ = m
                                .append_stm_for_session(&session_id, "system", &pending_marker)
                                .await;
                        }

                        loop_context.push(ChatMessage {
                            role: "system".to_string(),
                            content: format!(
                                "BLOCKED: The skill '{}' requires explicit user confirmation before it can run. \
                                 Describe exactly what this skill will do and what changes it will make, \
                                 then ask the user to confirm. Do NOT invoke the skill again until the user confirms.",
                                skill_name
                            ),
                        });
                        continue;
                    }

                    info!(
                        "Skill '{}' confirmed by user, proceeding with execution",
                        skill_name
                    );
                }

                let result = execution.execute(&manifest, &args).await;

                let feedback = match &result {
                    Ok(out) => {
                        consecutive_errors = 0;
                        emit(&stream_tx, serde_json::json!({
                            "type": "skill_result", "skill": skill_name, "success": true, "output": out
                        })).await;
                        let safe_out = sanitize_invoke_tags(out);
                        format!("SKILL RESULT [{}] (success):\n{}", skill_name, safe_out)
                    }
                    Err(e) => {
                        consecutive_errors += 1;
                        emit(&stream_tx, serde_json::json!({
                            "type": "skill_result", "skill": skill_name, "success": false, "output": e.to_string()
                        })).await;
                        let safe_err = sanitize_invoke_tags(&e.to_string());
                        let err_lower = e.to_string().to_lowercase();
                        let repair_hint = if err_lower.contains("not found")
                            || err_lower.contains("command not found")
                            || err_lower.contains("no such file")
                        {
                            format!(
                                "\n\nThis looks like a missing dependency. You can self-repair this skill:\n\
                                 1. <invoke name=\"skill\">[\"read\", \"{}\"]</invoke>\n\
                                 2. Fix the run.sh to remove the missing dependency (use grep/sed/awk instead of jq, etc.)\n\
                                 3. <invoke name=\"skill\">[\"modify\", \"{}\", \"run.sh\", \"<entire fixed run.sh content>\"]</invoke>",
                                skill_name, skill_name
                            )
                        } else {
                            String::new()
                        };
                        format!(
                            "SKILL RESULT [{}] (error): {}{}",
                            skill_name, safe_err, repair_hint
                        )
                    }
                };

                if consecutive_errors >= 3 {
                    // Give orchestrator workers one replan chance before giving up
                    let is_orchestrator =
                        origin == "ORCHESTRATOR_EPHEMERAL" || origin == "ORCHESTRATOR";
                    let replan_key = "REPLAN_ATTEMPTED";
                    let has_replanned = loop_context
                        .iter()
                        .any(|m| m.role == "system" && m.content.contains(replan_key));

                    if is_orchestrator && !has_replanned {
                        info!(
                            "ReAct loop: 3 consecutive skill errors at iter {}, allowing one replan",
                            iter
                        );
                        consecutive_errors = 0;
                        loop_context.push(ChatMessage {
                            role: "system".to_string(),
                            content: format!(
                                "{}\n\n{}\nYou have hit 3 consecutive skill errors. REPLAN: Try a different approach—use a different skill, fix the workflow, or work around the failure. Do NOT repeat the same failing invocation. You have ONE more attempt.",
                                feedback, replan_key
                            ),
                        });
                        continue;
                    }

                    info!(
                        "ReAct loop: 3 consecutive skill errors at iter {}, stopping",
                        iter
                    );
                    exited_due_to_consecutive_errors = true;
                    loop_context.push(ChatMessage {
                        role: "system".to_string(),
                        content: format!(
                            "{}\n\nToo many consecutive skill errors. Stop and report the issue to the user.",
                            feedback
                        ),
                    });
                    break;
                }

                loop_context.push(ChatMessage {
                    role: "system".to_string(),
                    content: format!(
                        "{}\n\nIf the user's original request requires more steps, invoke the next skill immediately. \
                         If the task is complete, present a concise final summary.",
                        feedback
                    ),
                });

                continue;
            }

            if response_text.contains("[CONTINUE]") {
                let clean = response_text.replace("[CONTINUE]", "").trim().to_string();
                if !clean.is_empty() {
                    emit(
                        &stream_tx,
                        serde_json::json!({ "type": "thinking", "text": clean }),
                    )
                    .await;
                }

                loop_context.push(ChatMessage {
                    role: "assistant".to_string(),
                    content: response_text.clone(),
                });

                info!("Agent continuing (iter {}): {}", iter, clean);
                continue;
            }

            // Orchestrator workers: nudge to continue if they produce text
            // without invoking a skill. This prevents premature exit when the
            // LLM "thinks out loud" between skill invocations.
            let is_orchestrator_loop =
                origin == "ORCHESTRATOR_EPHEMERAL" || origin == "ORCHESTRATOR";
            let has_done_work = loop_context
                .iter()
                .any(|m| m.role == "system" && m.content.contains("SKILL RESULT"));

            if is_orchestrator_loop && iter < 25 {
                if !has_done_work {
                    // No work done at all — strongly nudge to start
                    info!(
                        "ReAct loop: orchestrator worker no work at iter {}, nudging",
                        iter
                    );
                    loop_context.push(ChatMessage {
                        role: "assistant".to_string(),
                        content: response_text.clone(),
                    });
                    loop_context.push(ChatMessage {
                        role: "system".to_string(),
                        content: "You must use your available skills to complete the task. \
                            Do not describe what you plan to do — invoke a skill now to make progress."
                            .to_string(),
                    });
                    continue;
                }

                // Count how many nudges we've already sent (max 3 after work started)
                let nudge_count = loop_context
                    .iter()
                    .filter(|m| {
                        m.role == "system"
                            && m.content
                                .contains("If you have more work to do, invoke a skill")
                    })
                    .count();

                if nudge_count < 3 {
                    info!(
                        "ReAct loop: orchestrator worker text-only at iter {} (nudge {}), continuing",
                        iter,
                        nudge_count + 1
                    );
                    loop_context.push(ChatMessage {
                        role: "assistant".to_string(),
                        content: response_text.clone(),
                    });
                    loop_context.push(ChatMessage {
                        role: "system".to_string(),
                        content: "If you have more work to do, invoke a skill now to continue. \
                            If you are truly done with ALL steps in your workflow, report your final results."
                            .to_string(),
                    });
                    continue;
                }
            }

            final_response = response_text;
            break;
        }

        // Persist final response (brief lock)
        if !final_response.is_empty() {
            let m = memory.lock().await;
            let _ = m
                .append_stm_for_session(&session_id, "assistant", &final_response)
                .await;
        }

        emit(
            &stream_tx,
            serde_json::json!({ "type": "response", "text": final_response }),
        )
        .await;

        if final_response.starts_with("[ANNOUNCE]") {
            let m = memory.lock().await;
            let msg = final_response.trim_start_matches("[ANNOUNCE]").trim();
            let _ = m.add_swarm_memory(agent_name, msg).await;
        }

        if usage_event_count > 0 {
            emit(
                &stream_tx,
                build_token_usage_event(
                    iter,
                    TokenUsage {
                        input_tokens: 0,
                        output_tokens: 0,
                        total_tokens: 0,
                        estimated: cumulative_estimated,
                    },
                    cumulative_input_tokens,
                    cumulative_output_tokens,
                    cumulative_total_tokens,
                    cumulative_estimated,
                    None,
                    None,
                    true,
                ),
            )
            .await;
        }

        emit(&stream_tx, serde_json::json!({ "type": "done" })).await;

        if exited_due_to_consecutive_errors {
            return Err(anyhow::anyhow!(
                "ReAct loop stopped: too many consecutive skill errors. Report this to the user."
            ));
        }
        Ok(final_response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_usage_falls_back_to_char_based_tokens() {
        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: "abcd".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: "abcdef".to_string(),
            },
        ];
        let usage = estimate_usage(&messages, "abcdefgh");
        assert_eq!(usage.input_tokens, 3); // ceil((4 + 6) / 4)
        assert_eq!(usage.output_tokens, 2); // ceil(8 / 4)
        assert_eq!(usage.total_tokens, 5);
        assert!(usage.estimated);
    }

    #[test]
    fn token_usage_event_marks_final_and_cumulative_totals() {
        let evt = build_token_usage_event(
            4,
            TokenUsage {
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
                estimated: true,
            },
            120,
            44,
            164,
            true,
            Some("openai"),
            Some("gpt-4.1-mini"),
            true,
        );

        assert_eq!(evt["type"], "token_usage");
        assert_eq!(evt["iteration"], 4);
        assert_eq!(evt["cumulative"]["total"], 164);
        assert_eq!(evt["cumulative"]["estimated"], true);
        assert_eq!(evt["final"], true);
    }

    #[test]
    fn sanitize_invoke_tags_removes_single_invoke() {
        let input = r#"Hello <invoke name="shell">["ls"]</invoke> world"#;
        let out = sanitize_invoke_tags(input);
        assert!(!out.contains("<invoke"));
        assert!(!out.contains("</invoke>"));
        assert!(out.contains("Hello"));
        assert!(out.contains("world"));
        assert!(out.contains("[invoke tag removed for security]"));
    }

    #[test]
    fn sanitize_invoke_tags_removes_multiple_invokes() {
        let input = r#"<invoke name="a">[]</invoke> mid <invoke name="b">["x"]</invoke>"#;
        let out = sanitize_invoke_tags(input);
        assert_eq!(out.matches("[invoke tag removed for security]").count(), 2);
    }

    #[test]
    fn sanitize_invoke_tags_preserves_clean_text() {
        let input = "Nothing to sanitize here.";
        assert_eq!(sanitize_invoke_tags(input), input);
    }

    #[test]
    fn sanitize_invoke_tags_handles_multiline_body() {
        let input = "<invoke name=\"shell\">[\"echo\",\n\"hello\"]\n</invoke>";
        let out = sanitize_invoke_tags(input);
        assert!(out.contains("[invoke tag removed for security]"));
    }

    #[test]
    fn sanitize_invoke_tags_ignores_malformed_tags() {
        let input = "<invoke>no name attribute</invoke>";
        let out = sanitize_invoke_tags(input);
        assert_eq!(out, input);
    }

    #[test]
    fn origin_to_role_maps_user_origins() {
        assert_eq!(origin_to_role("USER"), "user");
        assert_eq!(origin_to_role("WEB_UI"), "user");
        assert_eq!(origin_to_role("TELEGRAM"), "user");
        assert_eq!(origin_to_role("MOBILE_APP"), "user");
        assert_eq!(origin_to_role("LOCAL_TUI"), "user");
    }

    #[test]
    fn origin_to_role_maps_assistant() {
        assert_eq!(origin_to_role("ASSISTANT"), "assistant");
    }

    #[test]
    fn origin_to_role_maps_telegram_prefixed_to_user() {
        assert_eq!(origin_to_role("TELEGRAM_12345"), "user");
    }

    #[test]
    fn origin_to_role_maps_discord_prefixed_to_user() {
        assert_eq!(origin_to_role("DISCORD_guild_channel"), "user");
    }

    #[test]
    fn origin_to_role_maps_system_origins() {
        assert_eq!(origin_to_role("SYSTEM"), "system");
        assert_eq!(origin_to_role("SYSTEM_CRON"), "system");
        assert_eq!(origin_to_role("WEBHOOK_github"), "system");
        assert_eq!(origin_to_role("SWARM_DELEGATION"), "system");
        assert_eq!(origin_to_role("MAC_POLLER"), "system");
    }

    #[test]
    fn is_human_origin_returns_true_for_interactive_channels() {
        assert!(is_human_origin("USER"));
        assert!(is_human_origin("WEB_UI"));
        assert!(is_human_origin("TELEGRAM"));
        assert!(is_human_origin("MOBILE_APP"));
        assert!(is_human_origin("LOCAL_TUI"));
        assert!(is_human_origin("TELEGRAM_12345"));
        assert!(is_human_origin("DISCORD_guild_channel"));
    }

    #[test]
    fn is_human_origin_returns_false_for_system_channels() {
        assert!(!is_human_origin("SYSTEM"));
        assert!(!is_human_origin("SYSTEM_CRON"));
        assert!(!is_human_origin("WEBHOOK_github"));
        assert!(!is_human_origin("SWARM_DELEGATION"));
        assert!(!is_human_origin("MAC_POLLER"));
        assert!(!is_human_origin("ASSISTANT"));
    }

    #[test]
    fn build_system_prompt_includes_skill_catalog() {
        let catalog = "- shell: Run shell commands\n";
        let prompt = AutonomousBrain::build_system_prompt_for_test(catalog, &None);
        assert!(prompt.contains("shell: Run shell commands"));
        assert!(prompt.contains("AVAILABLE SKILLS"));
        assert!(prompt.contains("END OF SKILLS"));
        assert!(!prompt.contains("AGENT PERSONA"));
    }

    #[test]
    fn build_system_prompt_includes_persona_when_present() {
        let catalog = "- shell: run\n";
        let persona = Some("I am a friendly coding assistant.".to_string());
        let prompt = AutonomousBrain::build_system_prompt_for_test(catalog, &persona);
        assert!(prompt.contains("AGENT PERSONA"));
        assert!(prompt.contains("friendly coding assistant"));
        assert!(prompt.contains("END PERSONA"));
    }

    #[test]
    fn build_system_prompt_contains_core_rules() {
        let prompt = AutonomousBrain::build_system_prompt_for_test("", &None);
        assert!(prompt.contains("SKILL INVOCATION FORMAT"));
        assert!(prompt.contains("<invoke name="));
        assert!(prompt.contains("MULTI-STEP"));
    }

    #[test]
    fn build_system_prompt_contains_confirmation_rule() {
        let prompt = AutonomousBrain::build_system_prompt_for_test("", &None);
        assert!(prompt.contains("REQUIRES CONFIRMATION"));
        assert!(prompt.contains("explicit confirmation"));
    }

    #[test]
    fn is_confirmation_accepts_simple_yes() {
        assert!(is_confirmation_message("yes"));
        assert!(is_confirmation_message("Yes"));
        assert!(is_confirmation_message("YES"));
        assert!(is_confirmation_message("y"));
        assert!(is_confirmation_message("Y"));
    }

    #[test]
    fn is_confirmation_accepts_affirmative_phrases() {
        assert!(is_confirmation_message("go ahead"));
        assert!(is_confirmation_message("Go ahead"));
        assert!(is_confirmation_message("proceed"));
        assert!(is_confirmation_message("do it"));
        assert!(is_confirmation_message("sure"));
        assert!(is_confirmation_message("ok"));
        assert!(is_confirmation_message("okay"));
        assert!(is_confirmation_message("yep"));
        assert!(is_confirmation_message("yeah"));
        assert!(is_confirmation_message("confirm"));
        assert!(is_confirmation_message("approved"));
        assert!(is_confirmation_message("go for it"));
        assert!(is_confirmation_message("yes please"));
        assert!(is_confirmation_message("please do"));
        assert!(is_confirmation_message("aye"));
    }

    #[test]
    fn is_confirmation_accepts_with_trailing_punctuation() {
        assert!(is_confirmation_message("yes!"));
        assert!(is_confirmation_message("yes."));
        assert!(is_confirmation_message("sure, go ahead"));
        assert!(is_confirmation_message("ok!"));
        assert!(is_confirmation_message("go ahead."));
    }

    #[test]
    fn is_confirmation_accepts_with_trailing_text() {
        assert!(is_confirmation_message("yes do it"));
        assert!(is_confirmation_message("ok sounds good"));
        assert!(is_confirmation_message("sure thing"));
        assert!(is_confirmation_message("go ahead and run it"));
    }

    #[test]
    fn is_confirmation_accepts_with_whitespace() {
        assert!(is_confirmation_message("  yes  "));
        assert!(is_confirmation_message("\nyes\n"));
        assert!(is_confirmation_message("  ok  "));
    }

    #[test]
    fn is_confirmation_rejects_non_confirmations() {
        assert!(!is_confirmation_message("no"));
        assert!(!is_confirmation_message("No"));
        assert!(!is_confirmation_message("cancel"));
        assert!(!is_confirmation_message("wait"));
        assert!(!is_confirmation_message("stop"));
        assert!(!is_confirmation_message("what does it do?"));
        assert!(!is_confirmation_message("can you explain more?"));
        assert!(!is_confirmation_message(
            "actually I want to modify the database module instead"
        ));
    }

    #[test]
    fn is_confirmation_rejects_long_messages() {
        let long_msg = "yes ".repeat(50);
        assert!(!is_confirmation_message(&long_msg));
    }

    #[test]
    fn is_confirmation_rejects_empty_input() {
        assert!(!is_confirmation_message(""));
        assert!(!is_confirmation_message("   "));
    }

    #[test]
    fn pending_confirm_marker_roundtrip() {
        let skill = "evolve_core";
        let marker = format!("{}{}]", PENDING_CONFIRM_PREFIX, skill);
        assert_eq!(marker, "[PENDING_CONFIRM:evolve_core]");
        assert!(marker.contains(PENDING_CONFIRM_PREFIX));
        assert!(marker.contains(skill));
    }
}
