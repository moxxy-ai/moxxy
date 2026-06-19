/**
 * Bounded connect/discovery timeout shared by every boot-time path that
 * opens a connection and lists tools. The per-call timeout in `wrap.ts`
 * (MCP_CALL_TIMEOUT_MS) only guards tool *invocations* — it does nothing
 * for the connect()+listTools() handshake performed at session boot
 * (refreshServerCache, eager createMcpPlugin) or on first lazy call. Without
 * a cap, a single unreachable HTTP/SSE endpoint or a stdio child that spawns
 * but never answers listTools blocks session boot forever (core awaits
 * onInit serially), so one stale entry in mcp.json can make moxxy unstartable.
 *
 * 30s is generous for a real handshake (npx cold-start, slow proxy auth) but
 * bounds the worst case to a skipped server rather than a wedged boot.
 */
export const MCP_CONNECT_TIMEOUT_MS = 30 * 1000;

/**
 * Race `work` against a hard timeout. On timeout the returned promise
 * rejects; `work` itself is not cancellable here (the MCP SDK connect/list
 * calls take no AbortSignal), so the caller is responsible for closing any
 * handle that escapes after the reject. The timer is always cleared so it
 * never keeps the event loop alive.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
