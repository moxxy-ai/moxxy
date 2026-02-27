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

export interface OrchestratorConfig {
  default_template_id?: string | null;
  default_worker_mode: 'existing' | 'ephemeral' | 'mixed';
  default_max_parallelism?: number | null;
  default_retry_limit: number;
  default_failure_policy: 'auto_replan' | 'fail_fast' | 'best_effort';
  default_merge_policy: 'manual_approval' | 'auto_on_review_pass';
  parallelism_warn_threshold: number;
}

export interface OrchestratorSpawnProfile {
  role: string;
  persona: string;
  provider: string;
  model: string;
  runtime_type: string;
  image_profile: string;
}

export interface OrchestratorTemplate {
  template_id: string;
  name: string;
  description: string;
  default_worker_mode?: 'existing' | 'ephemeral' | 'mixed';
  default_max_parallelism?: number;
  default_retry_limit?: number;
  default_failure_policy?: 'auto_replan' | 'fail_fast' | 'best_effort';
  default_merge_policy?: 'manual_approval' | 'auto_on_review_pass';
  spawn_profiles: OrchestratorSpawnProfile[];
}

export interface OrchestratorJob {
  job_id: string;
  status: string;
  prompt: string;
  worker_mode: string;
  summary?: string;
  error?: string;
}

export interface OrchestratorWorkerRun {
  worker_run_id: string;
  worker_agent: string;
  worker_mode: string;
  status: string;
  attempt: number;
  task_prompt?: string;
  output?: string | null;
  error?: string | null;
}

export interface OrchestratorEvent {
  id: number;
  event_type: string;
  payload_json: string;
  created_at: string;
}

export interface OrchestratorTask {
  task_id: string;
  job_id: string;
  role: string;
  title: string;
  description: string;
  context_json: string;
  depends_on_json: string;
  status: 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'skipped';
  worker_agent?: string | null;
  output?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export type TabId = 'Overview' | 'Interface' | 'Memory' | 'Skills' | 'Channels' | 'Schedules' | 'Webhooks' | 'MCPServers' | 'Orchestrator' | 'Templates' | 'Vault' | 'AccessTokens' | 'Config';
