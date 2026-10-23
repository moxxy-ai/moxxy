/** Provider name in the registry / model picker / provider config. */
export const OPENCODE_PROVIDER_ID = 'opencode';

/** Human-readable upstream service, shown in login and setup surfaces. */
export const OPENCODE_SERVICE_NAME = 'OpenCode';

/** Optional executable override for login/status surfaces that do not carry provider config. */
export const OPENCODE_EXECUTABLE_ENV = 'OPENCODE_EXECUTABLE';

/** What a fresh OpenCode runs; the person's own default wins when they set one. */
export const OPENCODE_DEFAULT_MODEL = 'opencode/big-pickle';

/**
 * What the picker offers before OpenCode is switched on and lists the person's own. Only the free model OpenCode
 * keeps: its promotional free models come and go (space-bunny-free was one), and the daily compat check fails
 * when one listed here is no longer offered.
 */
export const OPENCODE_FREE_MODELS: ReadonlyArray<string> = [OPENCODE_DEFAULT_MODEL];

/** The name Moxxy's MCP server has in the agent's session; OpenCode calls its tools `moxxy_<tool>`. */
export const MOXXY_MCP_SERVER = 'moxxy';

export const OPENCODE_ACP_ARGS = ['acp'] as const;
/** Where `opencode acp` serves its HTTP API: Moxxy reads OpenCode's background subagents there, which ACP does not report. */
export const OPENCODE_API_HOST = '127.0.0.1';
export const OPENCODE_API_USERNAME = 'opencode';
export const OPENCODE_SERVER_USERNAME_ENV = 'OPENCODE_SERVER_USERNAME';
export const OPENCODE_SERVER_PASSWORD_ENV = 'OPENCODE_SERVER_PASSWORD';
/** OpenCode 1.19's switch for subagents that work on after its turn (`task` with `background: true`). */
export const OPENCODE_BACKGROUND_SUBAGENTS_ENV = 'OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS';
export const OPENCODE_MODELS_ARGS = ['models'] as const;
export const OPENCODE_DEBUG_AGENT_ARGS = ['debug', 'agent'] as const;
export const OPENCODE_DEBUG_CONFIG_ARGS = ['debug', 'config'] as const;
export const OPENCODE_AUTH_LIST_ARGS = ['auth', 'list'] as const;
export const OPENCODE_AUTH_LOGIN_ARGS = ['auth', 'login'] as const;
export const OPENCODE_AUTH_LOGOUT_ARGS = ['auth', 'logout'] as const;
