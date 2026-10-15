/** Provider name in the registry / model picker / provider config. */
export const OPENCODE_PROVIDER_ID = 'opencode';

/** Human-readable upstream service, shown in login and setup surfaces. */
export const OPENCODE_SERVICE_NAME = 'OpenCode';

/** Optional executable override for login/status surfaces that do not carry provider config. */
export const OPENCODE_EXECUTABLE_ENV = 'OPENCODE_EXECUTABLE';

/** What a fresh OpenCode runs; the person's own default wins when they set one. */
export const OPENCODE_DEFAULT_MODEL = 'opencode/big-pickle';

/** OpenCode's free models: what the picker offers before OpenCode is switched on and lists the person's own. */
export const OPENCODE_FREE_MODELS: ReadonlyArray<string> = [OPENCODE_DEFAULT_MODEL, 'opencode/space-bunny-free'];

/** The name Moxxy's MCP server has in the agent's session; OpenCode calls its tools `moxxy_<tool>`. */
export const MOXXY_MCP_SERVER = 'moxxy';

export const OPENCODE_ACP_ARGS = ['acp'] as const;
export const OPENCODE_MODELS_ARGS = ['models'] as const;
export const OPENCODE_DEBUG_AGENT_ARGS = ['debug', 'agent'] as const;
export const OPENCODE_AUTH_LIST_ARGS = ['auth', 'list'] as const;
export const OPENCODE_AUTH_LOGIN_ARGS = ['auth', 'login'] as const;
export const OPENCODE_AUTH_LOGOUT_ARGS = ['auth', 'logout'] as const;
