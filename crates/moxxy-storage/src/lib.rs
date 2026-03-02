pub mod dao;
pub mod rows;

#[cfg(test)]
pub(crate) mod fixtures;

pub use dao::*;
pub use rows::*;

use rusqlite::Connection;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(conn: Connection) -> Self {
        Self { conn }
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn tokens(&self) -> TokenDao<'_> {
        TokenDao { conn: &self.conn }
    }

    pub fn agents(&self) -> AgentDao<'_> {
        AgentDao { conn: &self.conn }
    }

    pub fn providers(&self) -> ProviderDao<'_> {
        ProviderDao { conn: &self.conn }
    }

    pub fn heartbeats(&self) -> HeartbeatDao<'_> {
        HeartbeatDao { conn: &self.conn }
    }

    pub fn skills(&self) -> SkillDao<'_> {
        SkillDao { conn: &self.conn }
    }

    pub fn memory(&self) -> MemoryDao<'_> {
        MemoryDao { conn: &self.conn }
    }

    pub fn vault_refs(&self) -> VaultRefDao<'_> {
        VaultRefDao { conn: &self.conn }
    }

    pub fn vault_grants(&self) -> VaultGrantDao<'_> {
        VaultGrantDao { conn: &self.conn }
    }

    pub fn events(&self) -> EventAuditDao<'_> {
        EventAuditDao { conn: &self.conn }
    }
}
