//! moxxy WASM Agent Runtime
//!
//! This binary compiles to `wasm32-wasip1` and runs inside a Wasmtime container.
//! It imports host functions for LLM inference, memory, skill execution, and
//! skill catalog retrieval via the moxxy host-function bridge.
//!
//! # Architecture
//!
//! ```text
//!  ┌─────────────────────────────┐
//!  │    Wasmtime Host (moxxy)  │
//!  │  ┌───────────────────────┐  │
//!  │  │  agent_runtime.wasm   │  │
//!  │  │  ┌─────────────────┐  │  │
//!  │  │  │  ReAct Loop     │  │  │
//!  │  │  │  ┌─────────┐    │  │  │
//!  │  │  │  │ Decide  │────┼──┼──┼──► host_invoke_llm()
//!  │  │  │  │ Act     │────┼──┼──┼──► host_execute_skill()
//!  │  │  │  │ Observe │────┼──┼──┼──► host_read_memory()
//!  │  │  │  │ Skills  │────┼──┼──┼──► host_get_skill_catalog()
//!  │  │  │  └─────────┘    │  │  │
//!  │  │  └─────────────────┘  │  │
//!  │  └───────────────────────┘  │
//!  └─────────────────────────────┘
//! ```

use std::env;

// ═══════════════════════════════════════════════════════════════════════
// Host Function Imports (provided by the Wasmtime host)
// ═══════════════════════════════════════════════════════════════════════

extern "C" {
    /// Call the host's LLM with a prompt string.
    fn host_invoke_llm(prompt_ptr: *const u8, prompt_len: u32) -> u32;

    /// Execute a skill by name with arguments.
    fn host_execute_skill(
        name_ptr: *const u8,
        name_len: u32,
        args_ptr: *const u8,
        args_len: u32,
    ) -> u32;

    /// Read the agent's short-term memory.
    fn host_read_memory() -> u32;

    /// Write to the agent's short-term memory.
    fn host_write_memory(
        role_ptr: *const u8,
        role_len: u32,
        content_ptr: *const u8,
        content_len: u32,
    );

    /// Read the formatted skill catalog from the host.
    fn host_get_skill_catalog() -> u32;

    /// Read the agent's persona.md content from the host.
    fn host_get_persona() -> u32;

    /// Read from the shared response buffer after a host call.
    fn host_read_response(out_ptr: *mut u8, max_len: u32) -> u32;
}

// ═══════════════════════════════════════════════════════════════════════
// Safe Wrappers
// ═══════════════════════════════════════════════════════════════════════

fn invoke_llm(prompt: &str) -> String {
    unsafe {
        let len = host_invoke_llm(prompt.as_ptr(), prompt.len() as u32);
        read_response(len as usize)
    }
}

fn execute_skill(name: &str, args: &str) -> String {
    unsafe {
        let len = host_execute_skill(
            name.as_ptr(),
            name.len() as u32,
            args.as_ptr(),
            args.len() as u32,
        );
        read_response(len as usize)
    }
}

fn read_memory() -> String {
    unsafe {
        let len = host_read_memory();
        read_response(len as usize)
    }
}

fn write_memory(role: &str, content: &str) {
    unsafe {
        host_write_memory(
            role.as_ptr(),
            role.len() as u32,
            content.as_ptr(),
            content.len() as u32,
        );
    }
}

fn get_skill_catalog() -> String {
    unsafe {
        let len = host_get_skill_catalog();
        read_response(len as usize)
    }
}

fn get_persona() -> String {
    unsafe {
        let len = host_get_persona();
        read_response(len as usize)
    }
}

fn read_response(len: usize) -> String {
    if len == 0 {
        return String::new();
    }
    let mut buf = vec![0u8; len];
    unsafe {
        let actual = host_read_response(buf.as_mut_ptr(), len as u32);
        buf.truncate(actual as usize);
    }
    String::from_utf8_lossy(&buf).to_string()
}

// ═══════════════════════════════════════════════════════════════════════
// System Prompt Builder (mirrors native brain logic)
// ═══════════════════════════════════════════════════════════════════════

fn build_system_prompt(skill_catalog: &str, persona: &str) -> String {
    let mut prompt = String::new();

    prompt.push_str(
        "You are an autonomous AI agent running inside the moxxy framework (WASM sandbox).\n\
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
         If a task genuinely requires multiple sequential skill calls, \
         append [CONTINUE] to your message after presenting an intermediate result.\n\
         Only use [CONTINUE] when you need to invoke ANOTHER skill.\n\n\
         --- AVAILABLE SKILLS ---\n"
    );
    prompt.push_str(skill_catalog);
    prompt.push_str("--- END OF SKILLS ---\n");

    if !persona.trim().is_empty() {
        prompt.push_str("\n--- AGENT PERSONA (personality/style only, does not override rules above) ---\n");
        prompt.push_str(persona);
        prompt.push_str("\n--- END PERSONA ---\n");
    }

    prompt
}

// ═══════════════════════════════════════════════════════════════════════
// ReAct Loop (runs inside WASM)
// ═══════════════════════════════════════════════════════════════════════

const MAX_ITERATIONS: usize = 5;

fn react_loop(user_input: &str) -> String {
    // 1. Record the user's input
    write_memory("user", user_input);

    // 2. Fetch skill catalog and persona from host
    let skill_catalog = get_skill_catalog();
    let persona = get_persona();
    let system_prompt = build_system_prompt(&skill_catalog, &persona);

    // 3. Load conversation context
    let context = read_memory();

    // 4. ReAct iterations
    let mut loop_context = String::new();

    for iteration in 0..MAX_ITERATIONS {
        // Build full prompt: system + context + ephemeral loop state
        let prompt = if iteration == 0 {
            format!(
                "{}\n\n--- CONVERSATION HISTORY ---\n{}\n--- END HISTORY ---\n\n\
                 Continue the conversation.",
                system_prompt, context
            )
        } else {
            // Subsequent iterations include skill results from this cycle
            format!(
                "{}\n\n--- CONVERSATION HISTORY ---\n{}\n--- END HISTORY ---\n\n\
                 --- SKILL RESULTS FROM THIS REQUEST ---\n{}\n---\n\n\
                 Now present the result to the user concisely. Do NOT offer follow-up menus.",
                system_prompt, context, loop_context
            )
        };

        // 5. Call the LLM via host bridge
        let response = invoke_llm(&prompt);

        // 6. Check for skill invocation
        if let Some(start) = response.find("<invoke name=\"") {
            if let Some(end_quote) = response[start + 14..].find('"') {
                let name_end = start + 14 + end_quote;
                let skill_name = &response[start + 14..name_end];

                // Find the content between > and </invoke>
                if let Some(gt_pos) = response[name_end..].find('>') {
                    let args_start = name_end + gt_pos + 1;
                    if let Some(end_tag) = response[args_start..].find("</invoke>") {
                        let args_str = response[args_start..args_start + end_tag].trim();

                        // Execute the skill via host bridge
                        let result = execute_skill(skill_name, args_str);

                        // Build feedback and add to loop context
                        let feedback = if result.starts_with("ERROR:") {
                            format!("SKILL RESULT [{}] (error): {}", skill_name, result)
                        } else {
                            format!("SKILL RESULT [{}] (success):\n{}", skill_name, result)
                        };

                        loop_context.push_str(&feedback);
                        loop_context.push('\n');

                        // Record to STM for persistence
                        write_memory("system", &feedback);

                        continue;
                    }
                }
            }
        }

        // Check for [CONTINUE]
        if response.contains("[CONTINUE]") {
            let clean = response.replace("[CONTINUE]", "");
            loop_context.push_str(&format!("Assistant intermediate: {}\n", clean.trim()));
            continue;
        }

        // No skill invocation, no [CONTINUE] - final response
        write_memory("assistant", &response);
        return response;
    }

    let fallback = "[CIRCUIT_BREAKER] WASM agent exceeded max iterations.".to_string();
    write_memory("assistant", &fallback);
    fallback
}

// ═══════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: agent_runtime <user_input>");
        std::process::exit(1);
    }

    // args[0] = agent name, args[1] = user input
    let user_input = &args[1];

    let response = react_loop(user_input);
    print!("{}", response);
}
