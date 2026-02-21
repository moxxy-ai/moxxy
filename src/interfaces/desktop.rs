use anyhow::Result;
use async_trait::async_trait;
use global_hotkey::{
    GlobalHotKeyEvent, GlobalHotKeyManager,
    hotkey::{Code, HotKey, Modifiers},
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info};

use crate::core::brain::AutonomousBrain;
use crate::core::lifecycle::LifecycleComponent;
use crate::core::llm::LlmManager;
use crate::core::memory::MemorySystem;
use crate::skills::SkillManager;

#[allow(dead_code)]
pub struct DesktopInterface {
    agent_name: String,
    registry: Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>,
    skill_registry: Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>,
    llm_registry: Arc<Mutex<HashMap<String, Arc<Mutex<LlmManager>>>>>,
    hotkey_manager: Option<GlobalHotKeyManager>,
}

#[allow(dead_code)]
impl DesktopInterface {
    pub fn new(
        agent_name: String,
        registry: Arc<Mutex<HashMap<String, Arc<Mutex<MemorySystem>>>>>,
        skill_registry: Arc<Mutex<HashMap<String, Arc<Mutex<SkillManager>>>>>,
        llm_registry: Arc<Mutex<HashMap<String, Arc<Mutex<LlmManager>>>>>,
    ) -> Self {
        Self {
            agent_name,
            registry,
            skill_registry,
            llm_registry,
            hotkey_manager: None,
        }
    }

    // A simple hack using AppleScript to trigger a native input dialog on macOS
    async fn trigger_native_input_dialog() -> Option<String> {
        let script = r#"
            set dialogResult to display dialog "moxxy Prompt:" default answer "" with title "Agentic Overmind" buttons {"Cancel", "Execute"} default button "Execute"
            if button returned of dialogResult is "Execute" then
                return text returned of dialogResult
            else
                return ""
            end if
        "#;

        match tokio::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .await
        {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !stdout.is_empty() {
                    Some(stdout)
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// Specialized macOS Screen Reader using Accessibility APIs
    /// Dumps the entire UI element tree of the currently active window into text.
    #[allow(dead_code)]
    pub async fn get_active_window_text_context() -> Option<String> {
        let script = r#"
            tell application "System Events"
                set activeApp to first application process whose frontmost is true
                set frontWindow to front window of activeApp
                
                -- Attempt to grab the entire AX tree description natively
                try
                    set windowContext to value of attribute "AXDescription" of frontWindow
                    if windowContext is missing value then
                        set windowContext to title of frontWindow
                    end if
                on error
                    set windowContext to title of frontWindow
                end try
                
                return "Active Application: " & name of activeApp & "\nWindow Context: " & windowContext
            end tell
        "#;

        match tokio::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .await
        {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !stdout.is_empty() {
                    Some(stdout)
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    async fn trigger_native_notification(title: &str, message: &str) {
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            message.replace("\"", "\\\""),
            title.replace("\"", "\\\"")
        );
        let _ = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .spawn();
    }
}

#[async_trait]
impl LifecycleComponent for DesktopInterface {
    async fn on_init(&mut self) -> Result<()> {
        info!(
            "Desktop Host Interface initializing for [{}]...",
            self.agent_name
        );
        Ok(())
    }

    // Because Global-Hotkey currently spins up a macOS run-loop,
    // we need to safely spawn it in a dedicated thread to not block Tokio.
    async fn on_start(&mut self) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            let registry = self.registry.lock().await;
            if let Some(mem_mutex) = registry.get(&self.agent_name) {
                let mem = mem_mutex.lock().await;
                let vault = crate::core::vault::SecretsVault::new(mem.get_db());

                if let Ok(Some(enabled)) = vault.get_secret("desktop_hotkey_enabled").await
                    && enabled == "true" {
                        info!(
                            "[{}] Desktop Global Hotkey enabled (Cmd+Option+Space).",
                            self.agent_name
                        );

                        let manager = GlobalHotKeyManager::new().unwrap();
                        let hotkey =
                            HotKey::new(Some(Modifiers::META | Modifiers::ALT), Code::Space);

                        if let Err(e) = manager.register(hotkey) {
                            error!("Failed to register global hotkey: {:?}", e);
                            return Ok(());
                        }

                        self.hotkey_manager = Some(manager);
                        let global_hotkey_channel = GlobalHotKeyEvent::receiver();

                        let agent_name = self.agent_name.clone();
                        let skills = self
                            .skill_registry
                            .lock()
                            .await
                            .get(&self.agent_name)
                            .unwrap()
                            .clone();
                        let llms = self
                            .llm_registry
                            .lock()
                            .await
                            .get(&self.agent_name)
                            .unwrap()
                            .clone();
                        let memory = mem_mutex.clone();

                        // Spawn a dedicated listener task for the background event loop
                        tokio::spawn(async move {
                            loop {
                                if let Ok(event) = global_hotkey_channel.try_recv()
                                    && event.id == hotkey.id()
                                        && event.state == global_hotkey::HotKeyState::Pressed
                                    {
                                        info!(
                                            "[{}] Global hotkey triggered. Launching native prompt...",
                                            agent_name
                                        );

                                        // 1. Pop the OS-native dialog UI
                                        if let Some(mut prompt) =
                                            Self::trigger_native_input_dialog().await
                                        {
                                            let src_label = "DESKTOP_HOTKEY".to_string();
                                            Self::trigger_native_notification(
                                                "moxxy",
                                                "Thinking...",
                                            )
                                            .await;

                                            // 1.5 Inject macOS Active Window Context before execution
                                            if let Some(screen_dump) =
                                                Self::get_active_window_text_context().await
                                            {
                                                prompt = format!(
                                                    "[SYSTEM: The user's Active macOS Screen currently reads:]\n{}\n\n[USER COMMAND:]\n{}",
                                                    screen_dump, prompt
                                                );
                                            }

                                            // 2. Feed it into the ReAct loop
                                            let response = AutonomousBrain::execute_react_loop(
                                                &prompt,
                                                &src_label,
                                                llms.clone(),
                                                memory.clone(),
                                                skills.clone(),
                                                None,
                                            )
                                            .await;

                                            // 3. Notify the user of completion
                                            match response {
                                                Ok(text) => {
                                                    Self::trigger_native_notification(
                                                        "moxxy Reply",
                                                        &text,
                                                    )
                                                    .await
                                                }
                                                Err(e) => {
                                                    error!("Desktop ReAct failed: {}", e);
                                                    Self::trigger_native_notification(
                                                        "moxxy Error",
                                                        "Failed to process request.",
                                                    )
                                                    .await;
                                                }
                                            }
                                        }
                                    }
                                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                            }
                        });
                    }
            }
        }
        Ok(())
    }

    async fn on_shutdown(&mut self) -> Result<()> {
        if let Some(manager) = self.hotkey_manager.take() {
            // Unregister all hotkeys on shutdown
            let hotkey = HotKey::new(Some(Modifiers::META | Modifiers::ALT), Code::Space);
            let _ = manager.unregister(hotkey);
        }
        info!(
            "Desktop Host Interface shutting down for [{}]...",
            self.agent_name
        );
        Ok(())
    }
}
