export interface ChatMessage {
  id: number;
  sender: 'user' | 'agent';
  text: string;
}

export interface StreamMessage {
  sender: 'user' | 'agent';
  text: string;
}

export interface TokenUsageSnapshot {
  input: number;
  output: number;
  total: number;
  estimated: boolean;
}

export interface ChatStreamTokenUsageEvent {
  type: 'token_usage';
  iteration: number;
  delta: TokenUsageSnapshot;
  cumulative: TokenUsageSnapshot;
  provider?: string;
  model?: string;
  final?: boolean;
}

export interface ChatStreamReasoningEvent {
  type: 'reasoning';
  text: string;
  iteration: number;
}

export interface Skill {
  name: string;
  description: string;
  version: string;
  needs_network?: boolean;
  needs_fs_read?: boolean;
  needs_fs_write?: boolean;
  needs_env?: boolean;
  /** Platform: "all" (cross-platform), "windows", "macos", "linux" */
  platform?: string;
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
  is_paired?: boolean;
  stt_enabled?: boolean;
  has_stt_token?: boolean;
  listen_channels?: string[];
  listen_mode?: string;
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
  has_secret: boolean;
  prompt_template: string;
  active: boolean;
  created_at: string;
}

export interface ApiToken {
  id: string;
  name: string;
  created_at: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  default_model: string;
  custom?: boolean;
  vault_key: string;
  base_url: string;
  models: { id: string; name: string }[];
}

export type TabId = 'Overview' | 'Interface' | 'Memory' | 'Skills' | 'Channels' | 'Schedules' | 'Webhooks' | 'MCPServers' | 'Vault' | 'AccessTokens' | 'Config';
