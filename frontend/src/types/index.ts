export interface ChatMessage {
  id: number;
  sender: 'user' | 'agent';
  text: string;
}

export interface StreamMessage {
  sender: 'user' | 'agent';
  text: string;
}

export interface Skill {
  name: string;
  description: string;
  version: string;
  needs_network?: boolean;
  needs_fs_read?: boolean;
  needs_fs_write?: boolean;
  needs_env?: boolean;
}

export interface Schedule {
  name: string;
  cron: string;
  prompt: string;
  source: string;
}

export interface Channel {
  type: string;
  has_token: boolean;
  is_paired: boolean;
  stt_enabled?: boolean;
  has_stt_token?: boolean;
}

export interface McpServer {
  name: string;
  command: string;
  args: string;
  env: string;
}

export interface Webhook {
  name: string;
  source: string;
  secret: string;
  prompt_template: string;
  active: boolean;
  created_at: string;
}

export type TabId = 'Overview' | 'Interface' | 'Memory' | 'Skills' | 'Channels' | 'Schedules' | 'Webhooks' | 'MCPServers' | 'Vault' | 'Config';
