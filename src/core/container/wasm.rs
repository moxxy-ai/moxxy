use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;
use wasmtime::*;
use wasmtime_wasi::p1::{self, WasiP1Ctx};
use wasmtime_wasi::{DirPerms, FilePerms, WasiCtxBuilder};

use crate::core::llm::{ChatMessage, LlmManager};
use crate::core::memory::MemorySystem;
use crate::skills::SkillManager;

use super::config::ContainerConfig;
use super::profiles::ImageProfile;

struct HostState {
    wasi: WasiP1Ctx,
    response_buffer: Vec<u8>,
    bridge: Option<HostBridge>,
    limiter: StoreLimits,
}

struct HostBridge {
    llm: Arc<Mutex<LlmManager>>,
    memory: Arc<Mutex<MemorySystem>>,
    skills: Arc<Mutex<SkillManager>>,
    stream_tx: Option<tokio::sync::mpsc::Sender<String>>,
    rt_handle: tokio::runtime::Handle,
}

#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(dead_code)]
pub enum ContainerStatus {
    Created,
    Running,
    Stopped,
    Failed,
}

impl std::fmt::Display for ContainerStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ContainerStatus::Created => write!(f, "created"),
            ContainerStatus::Running => write!(f, "running"),
            ContainerStatus::Stopped => write!(f, "stopped"),
            ContainerStatus::Failed => write!(f, "failed"),
        }
    }
}

pub struct AgentContainer {
    config: ContainerConfig,
    agent_name: String,
    workspace_dir: std::path::PathBuf,
    status: std::sync::atomic::AtomicU8,
    execution_count: std::sync::atomic::AtomicU64,
}

impl AgentContainer {
    pub fn new(
        config: ContainerConfig,
        agent_name: String,
        workspace_dir: std::path::PathBuf,
    ) -> Self {
        Self {
            config,
            agent_name,
            workspace_dir,
            status: std::sync::atomic::AtomicU8::new(0),
            execution_count: std::sync::atomic::AtomicU64::new(0),
        }
    }

    #[allow(dead_code)]
    pub fn status(&self) -> ContainerStatus {
        match self.status.load(std::sync::atomic::Ordering::Relaxed) {
            0 => ContainerStatus::Created,
            1 => ContainerStatus::Running,
            2 => ContainerStatus::Stopped,
            _ => ContainerStatus::Failed,
        }
    }

    fn set_status(&self, status: ContainerStatus) {
        let val = match status {
            ContainerStatus::Created => 0,
            ContainerStatus::Running => 1,
            ContainerStatus::Stopped => 2,
            ContainerStatus::Failed => 3,
        };
        self.status.store(val, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn execution_count(&self) -> u64 {
        self.execution_count
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    #[allow(dead_code)]
    pub fn agent_name(&self) -> &str {
        &self.agent_name
    }
    #[allow(dead_code)]
    pub fn runtime_type(&self) -> &str {
        &self.config.runtime.r#type
    }
    #[allow(dead_code)]
    pub fn max_memory_mb(&self) -> u64 {
        self.config.capabilities.max_memory_mb
    }

    /// Execute a user message through the WASM-contained agent brain.
    pub async fn execute(
        &self,
        input: &str,
        llm: Arc<Mutex<LlmManager>>,
        memory: Arc<Mutex<MemorySystem>>,
        skills: Arc<Mutex<SkillManager>>,
        stream_tx: Option<tokio::sync::mpsc::Sender<String>>,
    ) -> Result<String> {
        self.set_status(ContainerStatus::Running);
        self.execution_count
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        let image_name = self
            .config
            .runtime
            .image
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("No WASM image specified in container.toml"))?;

        let wasm_path = ImageProfile::resolve(image_name, &self.workspace_dir);
        if !wasm_path.exists() {
            self.set_status(ContainerStatus::Failed);
            return Err(anyhow::anyhow!(
                "WASM image not found at {:?}. Available profiles: base, networked, full",
                wasm_path
            ));
        }

        info!(
            "WASM Container [{}] executing (image: {}, mem_limit: {}MB, exec #{})",
            self.agent_name,
            image_name,
            if self.config.capabilities.max_memory_mb > 0 {
                self.config.capabilities.max_memory_mb.to_string()
            } else {
                "unlimited".to_string()
            },
            self.execution_count()
        );

        let workspace_dir = self.workspace_dir.clone();
        let agent_name = self.agent_name.clone();
        let config = self.config.clone();
        let input_owned = input.to_string();
        let rt_handle = tokio::runtime::Handle::current();

        let result = tokio::task::spawn_blocking(move || -> Result<String> {
            let mut engine_config = Config::new();
            engine_config.wasm_multi_memory(true);
            let engine = Engine::new(&engine_config)?;

            let mut wasi_builder = WasiCtxBuilder::new();
            wasi_builder.args(&[&agent_name, &input_owned]);
            wasi_builder.env("AGENT_NAME", &agent_name);
            wasi_builder.inherit_stdout();
            wasi_builder.inherit_stderr();

            // Validate and mount preopened directories, blocking path traversal attempts.
            let workspace_canonical = workspace_dir
                .canonicalize()
                .unwrap_or_else(|_| workspace_dir.clone());

            for fs_path in &config.capabilities.filesystem {
                let raw = fs_path.trim_start_matches("./");
                let host_path = workspace_dir.join(raw);
                if !host_path.exists() {
                    continue;
                }
                let canonical = match host_path.canonicalize() {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                if !canonical.starts_with(&workspace_canonical) {
                    tracing::warn!(
                        "WASM Container [{}]: Blocked filesystem path escape attempt: {:?} resolves to {:?}",
                        agent_name,
                        fs_path,
                        canonical
                    );
                    continue;
                }
                let guest_path = format!("/{}", raw);
                wasi_builder.preopened_dir(
                    &host_path,
                    &guest_path,
                    DirPerms::all(),
                    FilePerms::all(),
                )?;
            }

            let mut limits_builder = StoreLimitsBuilder::new();
            if config.capabilities.max_memory_mb > 0 {
                limits_builder = limits_builder
                    .memory_size(config.capabilities.max_memory_mb as usize * 1024 * 1024);
                info!(
                    "WASM Container: Memory limit set to {}MB",
                    config.capabilities.max_memory_mb
                );
            }
            let store_limits = limits_builder.build();

            let wasi_ctx = wasi_builder.build_p1();
            let host_state = HostState {
                wasi: wasi_ctx,
                response_buffer: Vec::new(),
                bridge: Some(HostBridge {
                    llm,
                    memory,
                    skills,
                    stream_tx,
                    rt_handle,
                }),
                limiter: store_limits,
            };

            let mut linker: Linker<HostState> = Linker::new(&engine);
            p1::add_to_linker_sync(&mut linker, |state: &mut HostState| &mut state.wasi)?;

            // ─── Register Host Bridge Functions ───

            linker.func_wrap(
                "env",
                "host_invoke_llm",
                |mut caller: Caller<'_, HostState>, prompt_ptr: u32, prompt_len: u32| -> u32 {
                    let Some(mem) = caller.get_export("memory").and_then(|e| e.into_memory())
                    else {
                        let err = b"ERROR: WASM memory export not found";
                        caller.data_mut().response_buffer = err.to_vec();
                        return err.len() as u32;
                    };
                    let data = mem.data(&caller);
                    let prompt = std::str::from_utf8(
                        &data[prompt_ptr as usize..(prompt_ptr + prompt_len) as usize],
                    )
                    .unwrap_or("")
                    .to_string();

                    let Some(bridge) = caller.data().bridge.as_ref() else {
                        let err = b"ERROR: Host bridge not initialized";
                        caller.data_mut().response_buffer = err.to_vec();
                        return err.len() as u32;
                    };
                    let llm = bridge.llm.clone();
                    let rt = bridge.rt_handle.clone();

                    info!("WASM host_invoke_llm: prompt {} chars", prompt.len());

                    let messages =
                        if let Some(history_start) = prompt.find("--- CONVERSATION HISTORY ---") {
                            let system_part = prompt[..history_start].trim().to_string();
                            let user_part = prompt[history_start..].trim().to_string();
                            vec![
                                ChatMessage {
                                    role: "system".to_string(),
                                    content: system_part,
                                },
                                ChatMessage {
                                    role: "user".to_string(),
                                    content: user_part,
                                },
                            ]
                        } else {
                            vec![ChatMessage {
                                role: "user".to_string(),
                                content: prompt,
                            }]
                        };

                    let response = rt.block_on(async {
                        let llm_guard = llm.lock().await;
                        match tokio::time::timeout(
                            std::time::Duration::from_secs(120),
                            llm_guard.generate_with_selected(&messages),
                        )
                        .await
                        {
                            Ok(Ok(text)) => text,
                            Ok(Err(e)) => format!("LLM Error: {}", e),
                            Err(_) => "LLM Error: request timed out after 120 seconds".to_string(),
                        }
                    });

                    info!("WASM host_invoke_llm: response {} chars", response.len());

                    let bytes = response.as_bytes().to_vec();
                    let len = bytes.len() as u32;
                    caller.data_mut().response_buffer = bytes;
                    len
                },
            )?;

            linker.func_wrap("env", "host_execute_skill", |mut caller: Caller<'_, HostState>, name_ptr: u32, name_len: u32, args_ptr: u32, args_len: u32| -> u32 {
                let Some(mem) = caller.get_export("memory").and_then(|e| e.into_memory()) else {
                    let err = b"ERROR: WASM memory export not found";
                    caller.data_mut().response_buffer = err.to_vec();
                    return err.len() as u32;
                };
                let data = mem.data(&caller);
                let name = std::str::from_utf8(&data[name_ptr as usize..(name_ptr + name_len) as usize]).unwrap_or("").to_string();
                let args_str = std::str::from_utf8(&data[args_ptr as usize..(args_ptr + args_len) as usize]).unwrap_or("").to_string();

                let Some(bridge) = caller.data().bridge.as_ref() else {
                    let err = b"ERROR: Host bridge not initialized";
                    caller.data_mut().response_buffer = err.to_vec();
                    return err.len() as u32;
                };
                let skills = bridge.skills.clone();
                let stream_tx = bridge.stream_tx.clone();
                let rt = bridge.rt_handle.clone();

                info!("WASM host_execute_skill: name={}, args={}", name, args_str);

                if let Some(ref tx) = stream_tx {
                    let _ = rt.block_on(tx.send(
                        serde_json::json!({ "type": "skill_invoke", "skill": name, "args": args_str }).to_string()
                    ));
                }

                let result = rt.block_on(async {
                    let args: Vec<String> = serde_json::from_str(&args_str).unwrap_or_else(|_| vec![args_str.clone()]);
                    let (manifest, execution) = {
                        let s = skills.lock().await;
                        match s.prepare_skill(&name) {
                            Ok(prepared) => prepared,
                            Err(e) => return format!("ERROR: {}", e),
                        }
                    };
                    execution.execute(&manifest, &args).await.unwrap_or_else(|e| format!("ERROR: {}", e))
                });

                let success = !result.starts_with("ERROR:");
                info!("WASM host_execute_skill: result {} chars, success={}", result.len(), success);

                if let Some(ref tx) = stream_tx {
                    let _ = rt.block_on(tx.send(
                        serde_json::json!({ "type": "skill_result", "skill": name, "success": success, "output": result }).to_string()
                    ));
                }

                let bytes = result.as_bytes().to_vec();
                let len = bytes.len() as u32;
                caller.data_mut().response_buffer = bytes;
                len
            })?;

            linker.func_wrap(
                "env",
                "host_read_memory",
                |mut caller: Caller<'_, HostState>| -> u32 {
                    let Some(bridge) = caller.data().bridge.as_ref() else {
                        return 0;
                    };
                    let memory = bridge.memory.clone();
                    let rt = bridge.rt_handle.clone();

                    let content = rt.block_on(async {
                        let m = memory.lock().await;
                        m.read_short_term_memory().await.unwrap_or_default()
                    });

                    let bytes = content.as_bytes().to_vec();
                    let len = bytes.len() as u32;
                    caller.data_mut().response_buffer = bytes;
                    len
                },
            )?;

            linker.func_wrap(
                "env",
                "host_get_skill_catalog",
                |mut caller: Caller<'_, HostState>| -> u32 {
                    let Some(bridge) = caller.data().bridge.as_ref() else {
                        return 0;
                    };
                    let skills = bridge.skills.clone();
                    let rt = bridge.rt_handle.clone();

                    let catalog = rt.block_on(async {
                        let s = skills.lock().await;
                        s.get_skill_catalog()
                    });

                    let bytes = catalog.as_bytes().to_vec();
                    let len = bytes.len() as u32;
                    caller.data_mut().response_buffer = bytes;
                    len
                },
            )?;

            linker.func_wrap(
                "env",
                "host_get_persona",
                |mut caller: Caller<'_, HostState>| -> u32 {
                    let Some(bridge) = caller.data().bridge.as_ref() else {
                        return 0;
                    };
                    let memory = bridge.memory.clone();
                    let rt = bridge.rt_handle.clone();

                    let persona = rt.block_on(async {
                        let m = memory.lock().await;
                        let persona_path = m.workspace_dir().join("persona.md");
                        tokio::fs::read_to_string(&persona_path)
                            .await
                            .unwrap_or_default()
                    });

                    let bytes = persona.as_bytes().to_vec();
                    let len = bytes.len() as u32;
                    caller.data_mut().response_buffer = bytes;
                    len
                },
            )?;

            linker.func_wrap(
                "env",
                "host_write_memory",
                |mut caller: Caller<'_, HostState>,
                 role_ptr: u32,
                 role_len: u32,
                 content_ptr: u32,
                 content_len: u32| {
                    let Some(mem) = caller.get_export("memory").and_then(|e| e.into_memory())
                    else {
                        return;
                    };
                    let data = mem.data(&caller);
                    let role = std::str::from_utf8(
                        &data[role_ptr as usize..(role_ptr + role_len) as usize],
                    )
                    .unwrap_or("SYSTEM")
                    .to_string();
                    let content = std::str::from_utf8(
                        &data[content_ptr as usize..(content_ptr + content_len) as usize],
                    )
                    .unwrap_or("")
                    .to_string();

                    info!(
                        "WASM host_write_memory: role={}, content={} chars",
                        role,
                        content.len()
                    );

                    if role.eq_ignore_ascii_case("assistant") {
                        info!(
                            "WASM: Captured assistant response ({} chars) into response_buffer",
                            content.len()
                        );
                        caller.data_mut().response_buffer = content.as_bytes().to_vec();
                    }

                    let Some(bridge) = caller.data().bridge.as_ref() else {
                        return;
                    };
                    let memory = bridge.memory.clone();
                    let rt = bridge.rt_handle.clone();

                    rt.block_on(async {
                        let m = memory.lock().await;
                        let _ = m.append_short_term_memory(&role, &content).await;
                    });
                },
            )?;

            linker.func_wrap(
                "env",
                "host_read_response",
                |mut caller: Caller<'_, HostState>, out_ptr: u32, max_len: u32| -> u32 {
                    let response = caller.data().response_buffer.clone();
                    let copy_len = std::cmp::min(response.len(), max_len as usize);

                    let Some(mem) = caller.get_export("memory").and_then(|e| e.into_memory())
                    else {
                        return 0;
                    };
                    mem.data_mut(&mut caller)[out_ptr as usize..out_ptr as usize + copy_len]
                        .copy_from_slice(&response[..copy_len]);
                    copy_len as u32
                },
            )?;

            // ─── Instantiate with Resource Limits ───

            let module = Module::from_file(&engine, &wasm_path)?;
            let mut store = Store::new(&engine, host_state);
            store.limiter(|state| &mut state.limiter);

            let instance = linker.instantiate(&mut store, &module)?;

            let start = instance.get_typed_func::<(), ()>(&mut store, "_start")?;
            match start.call(&mut store, ()) {
                Ok(()) => {}
                Err(e) => {
                    if let Some(exit) = e.downcast_ref::<wasmtime_wasi::I32Exit>() {
                        if exit.0 != 0 {
                            return Err(anyhow::anyhow!("WASM agent exited with code {}", exit.0));
                        }
                    } else {
                        return Err(anyhow::anyhow!("WASM agent execution failed: {}", e));
                    }
                }
            }

            let response = String::from_utf8_lossy(&store.data().response_buffer).to_string();
            info!(
                "WASM execution complete: response_buffer={} chars",
                response.len()
            );
            if response.is_empty() {
                Ok("WASM agent produced no response.".to_string())
            } else {
                Ok(response)
            }
        });

        let result = match tokio::time::timeout(std::time::Duration::from_secs(180), result).await {
            Ok(join_result) => join_result?,
            Err(_) => {
                self.set_status(ContainerStatus::Failed);
                return Err(anyhow::anyhow!(
                    "WASM execution timed out after 180 seconds"
                ));
            }
        };

        match &result {
            Ok(_) => self.set_status(ContainerStatus::Running),
            Err(_) => self.set_status(ContainerStatus::Failed),
        }

        result
    }
}
