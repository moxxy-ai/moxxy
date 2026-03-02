/**
 * SSE stream reader for event tailing.
 * Uses native fetch with streaming reader.
 */

export function buildSseUrl(baseUrl, filters) {
  const url = new URL('/v1/events/stream', baseUrl);
  for (const [k, v] of Object.entries(filters)) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

export function parseSseEvent(line) {
  if (line.startsWith('data: ')) {
    return JSON.parse(line.slice(6));
  }
  return null;
}

export function createSseClient(baseUrl, token, filters) {
  const url = buildSseUrl(baseUrl, filters);
  let controller = null;

  return {
    url,
    token,

    reconnect() {
      if (controller) {
        controller.abort();
      }
      controller = new AbortController();
      return controller;
    },

    async *stream() {
      controller = new AbortController();
      const resp = await fetch(url, {
        headers: { 'authorization': `Bearer ${token}` },
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`SSE connection failed: HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const event = parseSseEvent(line);
            if (event) yield event;
          }
        }
      } finally {
        reader.releaseLock();
      }
    },

    disconnect() {
      controller?.abort();
    },
  };
}
