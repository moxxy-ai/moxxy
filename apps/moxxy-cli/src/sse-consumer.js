/**
 * SSE event stream consumer for `moxxy events tail`.
 * Uses native fetch with streaming reader.
 */
export class SseConsumer {
  #url;
  #headers;
  #controller;
  #onEvent;
  #onError;

  constructor(url, token = null) {
    this.#url = url;
    this.#headers = {};
    if (token) {
      this.#headers['Authorization'] = `Bearer ${token}`;
    }
    this.#controller = null;
    this.#onEvent = null;
    this.#onError = null;
  }

  onEvent(fn) {
    this.#onEvent = fn;
    return this;
  }

  onError(fn) {
    this.#onError = fn;
    return this;
  }

  async connect() {
    this.#controller = new AbortController();
    try {
      const resp = await fetch(this.#url, {
        headers: this.#headers,
        signal: this.#controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`SSE connection failed: HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventData = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            eventData += line.slice(6);
          } else if (line === '' && eventData) {
            try {
              const parsed = JSON.parse(eventData);
              this.#onEvent?.(parsed);
            } catch {
              // Non-JSON data line
              this.#onEvent?.({ raw: eventData });
            }
            eventData = '';
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.#onError?.(err);
      }
    }
  }

  disconnect() {
    this.#controller?.abort();
  }
}

/**
 * Parse a single SSE event from raw lines (for testing).
 */
export function parseSseEvent(lines) {
  let data = '';
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      data += line.slice(6);
    }
  }
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return { raw: data };
  }
}
