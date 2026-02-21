use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_cron_scheduler::JobScheduler;
use tracing::{info, warn};

#[derive(Debug, PartialEq)]
pub enum LifecycleState {
    Init,
    PluginsLoad,
    ConnectChannels,
    Ready,
    Shutdown,
}

#[async_trait::async_trait]
pub trait LifecycleComponent {
    async fn on_init(&mut self) -> Result<()> {
        Ok(())
    }
    async fn on_start(&mut self) -> Result<()> {
        Ok(())
    }
    async fn on_shutdown(&mut self) -> Result<()> {
        Ok(())
    }
}

pub struct LifecycleManager {
    state: LifecycleState,
    components: Vec<Arc<Mutex<dyn LifecycleComponent + Send + Sync>>>,
    pub scheduler: JobScheduler,
}

impl LifecycleManager {
    pub async fn new() -> Result<Self> {
        let scheduler = JobScheduler::new().await?;
        Ok(Self {
            state: LifecycleState::Init,
            components: Vec::new(),
            scheduler,
        })
    }

    pub fn attach(&mut self, component: Arc<Mutex<dyn LifecycleComponent + Send + Sync>>) {
        self.components.push(component);
    }

    pub async fn start(&mut self) -> Result<()> {
        info!("Lifecycle Phase: Init");
        self.state = LifecycleState::Init;
        for comp in &self.components {
            comp.lock().await.on_init().await?;
        }

        info!("Lifecycle Phase: Plugins Load");
        self.state = LifecycleState::PluginsLoad;

        info!("Lifecycle Phase: Connect Channels");
        self.state = LifecycleState::ConnectChannels;

        // Call start sequentially for simplicity; can parallelize later if needed
        for comp in &self.components {
            comp.lock().await.on_start().await?;
        }

        info!("Lifecycle Phase: Ready (Starting Scheduler)");
        self.scheduler.start().await?;
        self.state = LifecycleState::Ready;

        Ok(())
    }

    pub async fn shutdown(&mut self) -> Result<()> {
        info!("Lifecycle Phase: Shutdown");
        self.state = LifecycleState::Shutdown;

        for comp in &self.components {
            if let Err(e) = comp.lock().await.on_shutdown().await {
                warn!("Component shutdown error: {}", e);
            }
        }

        Ok(())
    }
}
