/** Provider name in the registry / model picker / provider config. */
export const CODEX_AGENT_PROVIDER_ID = 'codex-agent';
/** The agent's name as the person knows it. */
export const CODEX_AGENT_NAME = 'Codex';

/** Human-readable upstream service, shown in login and setup surfaces. */
export const CODEX_SERVICE_NAME = 'ChatGPT subscription (Codex)';

/** Optional executable override for login/status surfaces that do not carry provider config. */
export const CODEX_EXECUTABLE_ENV = 'CODEX_EXECUTABLE';

/** The name Moxxy's MCP server has in Codex's thread config. */
export const MOXXY_MCP_SERVER = 'moxxy';

export const CODEX_APP_SERVER_ARGS = ['app-server'] as const;
export const CODEX_LOGIN_STATUS_ARGS = ['login', 'status'] as const;
export const CODEX_LOGIN_ARGS = ['login'] as const;
export const CODEX_LOGOUT_ARGS = ['logout'] as const;
