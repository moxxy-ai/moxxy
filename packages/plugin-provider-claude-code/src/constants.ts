/** Provider name in the registry / model picker / provider config. */
export const CLAUDE_CODE_PROVIDER_ID = 'claude-code';
/** The agent's name as the person knows it. */
export const CLAUDE_AGENT_NAME = 'Claude';

/** Human-readable upstream service, shown in login and setup surfaces. */
export const CLAUDE_CODE_SERVICE_NAME = 'Claude Code subscription';

/** Optional executable override for login/status surfaces that do not carry provider config. */
export const CLAUDE_CODE_EXECUTABLE_ENV = 'CLAUDE_CODE_EXECUTABLE';

/** Supported Claude Code authentication commands. Arguments stay separate from the executable. */
export const CLAUDE_AUTH_STATUS_ARGS = ['auth', 'status'] as const;
export const CLAUDE_AUTH_LOGIN_ARGS = ['auth', 'login'] as const;
export const CLAUDE_AUTH_LOGOUT_ARGS = ['auth', 'logout'] as const;
