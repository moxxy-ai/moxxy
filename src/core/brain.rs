use anyhow::Result;
use regex::Regex;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;

use crate::core::llm::LlmManager;
use crate::core::memory::MemorySystem;
use crate::skills::SkillManager;

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
fn build_system_prompt(skill_catalog: &str, persona_text: &Option<String>) -> String {
    let mut system_prompt = String::new();

    system_prompt.push_str(
        "You are an autonomous AI agent running inside the moxxy framework.\n\
         You have SKILLS that let you take real actions on the host system.\n\n\
         RULES:\n\
         1. When the user asks you to DO something (create files, fetch data, run commands, build things), \
            use your skills via the invocation format below. Do NOT respond with code snippets or instructions.\n\
         2. For pure knowledge questions (math, reasoning, explanations), respond directly.\n\
         3. Only use skills listed in AVAILABLE SKILLS. Never guess or invent skill names.\n\
         4. Never tell the user to run commands manually - use your skills instead.\n\
         5. NEVER use `host_shell` or `host_python` on your own. These are restricted to explicit user requests \
            (e.g. \"run this on my machine\"). Always use dedicated skills instead \
            (e.g. `git` for git, `github` for GitHub issues/PRs). \
            If no dedicated skill exists, ask the user before resorting to host_shell.\n\
         6. After a skill result is returned to you, present the result to the user and STOP. \
            Do NOT offer menus, ask what to do next, or continue unless the user's original request requires more steps.\n\
         7. Be concise. Answer the question, present the result, done.\n\n\
         SKILL INVOCATION FORMAT:\n\
         <invoke name=\"skill_name\">[\"arg1\", \"arg2\"]</invoke>\n\
         Arguments MUST be a valid JSON array of strings. Use [] for no arguments.\n\
         For [MCP] skills, pass a JSON object instead: <invoke name=\"mcp_skill\">{\"param\": \"value\"}</invoke>\n\
         After invoking a skill, STOP and wait for the system to return the result.\n\
         Do NOT output anything else in the same response as an <invoke> tag.\n\n\
         MULTI-STEP TASKS:\n\
         If a task genuinely requires multiple sequential skill calls (e.g. create a file then verify it), \
         append [CONTINUE] to your message after presenting an intermediate result.\n\
         Only use [CONTINUE] when you need to invoke ANOTHER skill. Never use it just to offer options.\n\n\
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
    pub async fn execute_react_loop(
        trigger_text: &str,
        origin: &str,
        llm: Arc<Mutex<LlmManager>>,
        memory: Arc<Mutex<MemorySystem>>,
        skills: Arc<Mutex<SkillManager>>,
        stream_tx: Option<tokio::sync::mpsc::Sender<String>>,
        agent_name: &str,
    ) -> Result<String> {
        info!("Brain activated by {}: {}", origin, trigger_text);

        let role = origin_to_role(origin);

        // Session isolation: non-human origins get a fresh session.
        let previous_session = {
            let mut m = memory.lock().await;
            if !is_human_origin(origin) {
                let old = m.new_session();
                info!("Isolated session for origin={}: {}", origin, m.session_id());
                Some(old)
            } else {
                None
            }
        };

        // 1. Write the trigger to STM
        {
            let m = memory.lock().await;
            let _ = m.append_short_term_memory(role, trigger_text).await;
            if role == "user" {
                let _ = m.add_long_term_memory(trigger_text).await;
            }
        }

        // 2. Load persona
        let persona_text = {
            let m = memory.lock().await;
            let workspace = m.workspace_dir();
            let persona_path = workspace.join("persona.md");
            match tokio::fs::read_to_string(&persona_path).await {
                Ok(text) if !text.trim().is_empty() => Some(text),
                _ => None,
            }
        };

        // 3. ReAct Loop
        let mut final_response = String::new();
        let max_iterations = 10;
        // Ephemeral context for the current loop - not persisted to STM.
        // This holds skill results and intermediate reasoning within a single request.
        let mut loop_context: Vec<crate::core::llm::ChatMessage> = Vec::new();
        let invoke_re =
            Regex::new(r#"<invoke\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)</invoke>"#).unwrap();

        for iter in 0..max_iterations {
            let response_text: String = {
                let llm_guard = llm.lock().await;
                let m = memory.lock().await;
                let stm_entries = m.read_stm_structured(60, true).await.unwrap_or_default();
                let swarm_kbs = m.read_swarm_memory(10).await.unwrap_or_default();

                let skill_catalog = {
                    let s = skills.lock().await;
                    s.get_skill_catalog()
                };

                let mut messages: Vec<crate::core::llm::ChatMessage> = Vec::new();

                // System prompt
                messages.push(crate::core::llm::ChatMessage {
                    role: "system".to_string(),
                    content: build_system_prompt(&skill_catalog, &persona_text),
                });

                // Swarm intelligence
                for kb_chunk in swarm_kbs {
                    messages.push(crate::core::llm::ChatMessage {
                        role: "system".to_string(),
                        content: format!("--- SWARM INTELLIGENCE ---\n{}\n---", kb_chunk),
                    });
                }

                // Conversation history from STM
                let max_history = 40;
                let start_idx = stm_entries.len().saturating_sub(max_history);
                for entry in stm_entries.into_iter().skip(start_idx) {
                    messages.push(crate::core::llm::ChatMessage {
                        role: entry.role.clone(),
                        content: entry.content.clone(),
                    });
                }

                // Ephemeral loop context (skill results from this request cycle)
                messages.extend(loop_context.iter().cloned());

                llm_guard
                    .generate_with_selected(&messages)
                    .await
                    .unwrap_or_else(|e| format!("LLM Error: {}", e))
            };

            info!("ReAct iter {}: {} chars", iter, response_text.len());

            // Check for skill invocation
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

                // Add the assistant's invoke to ephemeral context
                loop_context.push(crate::core::llm::ChatMessage {
                    role: "assistant".to_string(),
                    content: response_text.clone(),
                });

                // Execute the skill
                let (manifest, execution) = {
                    let s = skills.lock().await;
                    match s.prepare_skill(&skill_name) {
                        Ok(prepared) => prepared,
                        Err(e) => {
                            let err_msg = format!("Skill '{}' not found: {}", skill_name, e);
                            emit(&stream_tx, serde_json::json!({
                                "type": "skill_result", "skill": skill_name, "success": false, "output": e.to_string()
                            })).await;
                            loop_context.push(crate::core::llm::ChatMessage {
                                role: "system".to_string(),
                                content: err_msg,
                            });
                            continue;
                        }
                    }
                };
                let result = execution.execute(&manifest, &args).await;

                let feedback = match &result {
                    Ok(out) => {
                        emit(&stream_tx, serde_json::json!({
                            "type": "skill_result", "skill": skill_name, "success": true, "output": out
                        })).await;
                        let safe_out = sanitize_invoke_tags(out);
                        format!("SKILL RESULT [{}] (success):\n{}", skill_name, safe_out)
                    }
                    Err(e) => {
                        emit(&stream_tx, serde_json::json!({
                            "type": "skill_result", "skill": skill_name, "success": false, "output": e.to_string()
                        })).await;
                        let safe_err = sanitize_invoke_tags(&e.to_string());
                        format!("SKILL RESULT [{}] (error): {}", skill_name, safe_err)
                    }
                };

                // Add skill result to ephemeral context with clear instruction
                loop_context.push(crate::core::llm::ChatMessage {
                    role: "system".to_string(),
                    content: format!(
                        "{}\n\nNow present this result to the user concisely. Do NOT offer follow-up menus or ask what to do next.",
                        feedback
                    ),
                });

                continue; // Next iteration to let LLM present the result
            }

            // Check for [CONTINUE] - agent signals it needs another skill call
            if response_text.contains("[CONTINUE]") {
                let clean = response_text.replace("[CONTINUE]", "").trim().to_string();
                if !clean.is_empty() {
                    emit(
                        &stream_tx,
                        serde_json::json!({ "type": "thinking", "text": clean }),
                    )
                    .await;
                }

                loop_context.push(crate::core::llm::ChatMessage {
                    role: "assistant".to_string(),
                    content: response_text.clone(),
                });

                info!("Agent continuing (iter {}): {}", iter, clean);
                continue;
            }

            // Final response - no invoke, no [CONTINUE]
            final_response = response_text;
            break;
        }

        // Persist the final response to STM (only the final answer, not intermediate noise)
        if !final_response.is_empty() {
            let m = memory.lock().await;
            let _ = m
                .append_short_term_memory("assistant", &final_response)
                .await;
        }

        emit(
            &stream_tx,
            serde_json::json!({ "type": "response", "text": final_response }),
        )
        .await;

        // Broadcast to swarm if requested
        if final_response.starts_with("[ANNOUNCE]") {
            let m = memory.lock().await;
            let msg = final_response.trim_start_matches("[ANNOUNCE]").trim();
            let _ = m.add_swarm_memory(agent_name, msg).await;
        }

        // Restore previous session if we isolated
        if let Some(prev) = previous_session {
            let mut m = memory.lock().await;
            m.restore_session(prev);
        }

        emit(&stream_tx, serde_json::json!({ "type": "done" })).await;

        Ok(final_response)
    }
}
