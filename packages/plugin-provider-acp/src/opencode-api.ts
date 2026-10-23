/**
 * OpenCode's own HTTP API, which `opencode acp` serves beside ACP. ACP does
 * not report what a subagent does nor when a subagent working in the
 * background ends, and has no way to stop one; this API has both: its event
 * stream (`GET /event`) and `POST /session/{id}/abort`.
 */

/** Where the API of one running `opencode acp` is, and the credentials Moxxy started it with. */
export interface OpenCodeApi {
  readonly url: string;
  /** The `Authorization` header value. */
  readonly authorization: string;
}

/** One event of OpenCode's stream (`session.status`, `message.part.updated`, …). */
export interface OpenCodeEvent {
  readonly type: string;
  readonly properties: Record<string, unknown>;
}

export interface OpenCodeEventWatch {
  close(): void;
}

/** How long to wait before connecting again after the stream failed or ended. */
const RECONNECT_MS = 250;

/**
 * Read OpenCode's event stream for the project `directory` until closed,
 * connecting again whenever it ends (OpenCode serves the API a moment after it
 * starts). `onConnected` is told each time the stream is up.
 */
export function watchOpenCodeEvents(
  api: OpenCodeApi,
  directory: string,
  onEvent: (event: OpenCodeEvent) => void,
  opts: { readonly onConnected?: () => void; readonly onDisconnected?: () => void } = {},
): OpenCodeEventWatch {
  const stop = new AbortController();
  void (async () => {
    while (!stop.signal.aborted) {
      try {
        const response = await fetch(`${api.url}/event?directory=${encodeURIComponent(directory)}`, {
          headers: { Authorization: api.authorization, Accept: 'text/event-stream' },
          signal: stop.signal,
        });
        if (response.ok && response.body) {
          opts.onConnected?.();
          await readEvents(response.body, onEvent);
          opts.onDisconnected?.();
        }
      } catch {
        // Not up yet, or gone: try again below while the watch is open.
      }
      if (stop.signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
    }
  })();
  return { close: () => stop.abort() };
}

/** Stop what an OpenCode session runs (a subagent's session too). False when OpenCode could not be asked or refused. */
export async function abortOpenCodeSession(api: OpenCodeApi, directory: string, sessionId: string): Promise<boolean> {
  try {
    const response = await fetch(`${api.url}/session/${encodeURIComponent(sessionId)}/abort?directory=${encodeURIComponent(directory)}`, {
      method: 'POST',
      headers: { Authorization: api.authorization },
    });
    return response.ok && (await response.json().catch(() => false)) === true;
  } catch {
    return false;
  }
}

/** Server-sent events: each event's `data:` lines are one JSON object. */
async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (event: OpenCodeEvent) => void): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      const event = parseEvent(data);
      if (event) onEvent(event);
    }
  }
}

function parseEvent(data: string): OpenCodeEvent | undefined {
  if (!data) return undefined;
  try {
    const value = JSON.parse(data) as { type?: unknown; properties?: unknown };
    if (typeof value.type !== 'string') return undefined;
    const properties = typeof value.properties === 'object' && value.properties !== null ? (value.properties as Record<string, unknown>) : {};
    return { type: value.type, properties };
  } catch {
    return undefined;
  }
}
