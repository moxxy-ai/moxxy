type Listener = (event: unknown, method: string, params: unknown, sessionId?: string) => void;
interface DiagnosticsDebugger {
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on?(event: 'message', listener: Listener): void;
  removeListener?(event: 'message', listener: Listener): void;
}

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === 'object' ? value as RecordValue : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const MAX_ROWS = 100;
const MAX_TEXT = 1_000;
const MAX_BODY = 8_000;
const SECRET_KEY = /^(?:authorization|cookie|set[_-]?cookie|password|passwd|secret|client[_-]?secret|(?:access|refresh|id)[_-]?token|token|api[_-]?key|session[_-]?(?:id|token))$/i;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[redacted]' : redactValue(item)]));
  return typeof value === 'string' ? redactText(value) : value;
}

function redactText(value: string): string {
  return value.replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\b(password|client_secret|access_token|refresh_token|id_token|api[_-]?key)\s*[=:]\s*[^\s"',;&]+/gi, '$1=[redacted]');
}

function safeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (SECRET_KEY.test(key)) url.searchParams.set(key, '[redacted]');
    return url.href.slice(0, MAX_TEXT);
  } catch {
    return redactText(raw).slice(0, MAX_TEXT);
  }
}

interface ConsoleEntry {
  readonly level: string;
  readonly text: string;
  readonly url: string;
}

interface RequestEntry {
  readonly id: string;
  readonly url: string;
  readonly method: string;
  status?: number;
  mimeType?: string;
  finished?: boolean;
  error?: string;
}

/** A bounded, explicitly started recording; never reads cookies, headers or request bodies. */
export class PageDiagnostics {
  private recording = false;
  private started = 0;
  private dropped = 0;
  private readonly console: ConsoleEntry[] = [];
  private readonly network = new Map<string, RequestEntry>();
  private readonly listener = (_event: unknown, method: string, params: unknown, sessionId?: string): void => {
    if (!this.recording || sessionId) return;
    const p = object(params);
    if (method.startsWith('Runtime.') && typeof p.timestamp === 'number' && p.timestamp < this.started) return;
    if (method === 'Runtime.consoleAPICalled') {
      const args = Array.isArray(p.args) ? p.args.map(object) : [];
      this.addConsole(text(p.type), args.map((arg) => String(arg.value ?? arg.description ?? arg.unserializableValue ?? '')).join(' '));
    } else if (method === 'Runtime.exceptionThrown') {
      const details = object(p.exceptionDetails);
      this.addConsole('error', text(object(details.exception).description) || text(details.text));
    } else if (method === 'Network.requestWillBeSent') {
      const request = object(p.request);
      const id = text(p.requestId);
      if (!id) return;
      if (this.network.has(id)) this.network.delete(id); // Redirects reuse the request id; the final URL owns its response.
      this.network.set(id, { id, url: safeUrl(text(request.url)), method: text(request.method) });
      if (this.network.size > MAX_ROWS) {
        const first = this.network.keys().next().value;
        if (first !== undefined) this.network.delete(first);
        this.dropped++;
      }
    } else {
      const row = this.network.get(text(p.requestId));
      if (!row) return;
      if (method === 'Network.responseReceived') {
        const response = object(p.response);
        if (typeof response.status === 'number') row.status = response.status;
        row.mimeType = text(response.mimeType);
      } else if (method === 'Network.loadingFinished') row.finished = true;
      else if (method === 'Network.loadingFailed') {
        row.finished = true;
        row.error = text(p.errorText).slice(0, MAX_TEXT);
      }
    }
  };

  constructor(private readonly debuggerApi: DiagnosticsDebugger, private readonly pageUrl: () => string) {}

  private addConsole(level: string, value: string): void {
    this.console.push({ level, text: redactText(value).slice(0, MAX_TEXT), url: safeUrl(this.pageUrl()) });
    if (this.console.length > MAX_ROWS) {
      this.console.shift();
      this.dropped++;
    }
  }

  async start(): Promise<void> {
    if (this.recording) return;
    if (!this.debuggerApi.on || !this.debuggerApi.removeListener) throw new Error('this browser has no diagnostics event channel');
    this.console.length = 0;
    this.network.clear();
    this.dropped = 0;
    this.started = Date.now();
    this.recording = true;
    this.debuggerApi.on('message', this.listener);
    try {
      await this.debuggerApi.sendCommand('Network.enable', { maxTotalBufferSize: 1_048_576, maxResourceBufferSize: 65_536, maxPostDataSize: 0 });
      await this.debuggerApi.sendCommand('Runtime.enable', {});
      if (!this.recording) await this.disable(); // A takeover during enable must not restart collection.
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    this.debuggerApi.removeListener?.('message', this.listener);
    await this.disable();
  }

  private async disable(): Promise<void> {
    await Promise.allSettled([
      this.debuggerApi.sendCommand('Network.disable', {}),
      this.debuggerApi.sendCommand('Runtime.disable', {}),
    ]);
  }

  read(limit = 20, query = '') {
    const match = query.toLowerCase();
    const console = this.console.filter((row) => row.text.toLowerCase().includes(match));
    const network = [...this.network.values()].filter((row) => row.url.toLowerCase().includes(match));
    return { recording: this.recording, console: console.slice(-limit), network: network.slice(-limit),
      dropped: this.dropped, available: { console: console.length, network: network.length } };
  }

  async response(id: string) {
    const row = this.network.get(id);
    if (!this.recording || !row) throw new Error('request is not in the active recording');
    if (!row.finished || row.error) throw new Error(row.error || 'response has not finished loading');
    if (!row.mimeType || !/^(text\/|application\/(json|.*\+json|javascript|xml))/.test(row.mimeType)) throw new Error('response is not text');
    const reply = object(await this.debuggerApi.sendCommand('Network.getResponseBody', { requestId: id }));
    const raw = reply.base64Encoded === true ? Buffer.from(text(reply.body), 'base64').toString('utf8') : text(reply.body);
    let body = redactText(raw);
    if (/json/.test(row.mimeType)) {
      try { body = JSON.stringify(redactValue(JSON.parse(raw))); } catch { /* A broken JSON response is still useful diagnostic text. */ }
    }
    return { id, url: row.url, status: row.status, body: body.slice(0, MAX_BODY), truncated: body.length > MAX_BODY };
  }
}
