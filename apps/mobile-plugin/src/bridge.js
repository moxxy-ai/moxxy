export async function buildHealth(apiUrl, token) {
  try {
    const res = await bridgeFetch(apiUrl, token, '/v1/health');
    return { status: 'ok', bridge: { ok: res.ok, status: res.status } };
  } catch (err) {
    return { status: 'ok', bridge: { ok: false, message: errorMessage(err) } };
  }
}

export async function fetchSnapshot(apiUrl, token) {
  const res = await bridgeFetch(apiUrl, token, '/v1/snapshot');
  if (!res.ok) return { session: null, agents: [], pendingPermissions: [], commands: [] };
  return await res.json();
}

export async function postBridge(apiUrl, token, path, body) {
  const res = await bridgeFetch(apiUrl, token, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`bridge returned ${res.status}`);
  return await res.json().catch(() => ({}));
}

export async function streamBridgeTurn(apiUrl, token, frame, onPayload, signal) {
  const body = {
    prompt: String(frame.prompt ?? ''),
    ...(typeof frame.model === 'string' ? { model: frame.model } : {}),
    ...(typeof frame.systemPrompt === 'string' ? { systemPrompt: frame.systemPrompt } : {}),
    ...(Array.isArray(frame.attachments) && frame.attachments.length > 0 ? { attachments: frame.attachments } : {}),
  };
  const res = await bridgeFetch(apiUrl, token, '/v1/turn/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`bridge turn stream returned ${res.status}`);
  if (!res.body) return;
  await readSseStream(res.body, onPayload, signal);
}

export async function connectBridgeEvents(apiUrl, token, clients, signal) {
  const res = await bridgeFetch(apiUrl, token, '/v1/events/stream', { signal });
  if (!res.body) return;
  await readSseStream(res.body, (payload) => broadcastBridgePayload(clients, payload), signal);
}

async function readSseStream(body, onPayload, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const payload = parseSseChunk(chunk);
      if (payload) onPayload(payload);
    }
  }
}

async function bridgeFetch(apiUrl, token, path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  return await fetch(new URL(path, apiUrl), { ...init, headers });
}

function parseSseChunk(chunk) {
  const line = chunk.split('\n').find((candidate) => candidate.startsWith('data:'));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(5).trim());
  } catch {
    return null;
  }
}

function broadcastBridgePayload(clients, payload) {
  const frame = normalizeBridgeFrame(payload);
  for (const client of clients) sendFrame(client, frame);
}

function normalizeBridgeFrame(payload) {
  if (payload.type === 'ask.request') return payload;
  if (payload.type === 'ask.resolved') return payload;
  if (payload.type === 'permission.requested') return payload;
  if (payload.type === 'permission.resolved') return payload;
  if (payload.type === 'event') return payload;
  return { type: 'event', event: payload };
}

function sendFrame(ws, frame) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
