import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultSessionsDir() {
  return join(homedir(), '.moxxy', 'sessions');
}

export function createSessionCatalog(options = {}) {
  const dir = options.dir ?? defaultSessionsDir();
  const cacheTtlMs = typeof options.cacheTtlMs === 'number' ? options.cacheTtlMs : 1000;
  let cachedSessions = null;
  let cachedAt = 0;

  return {
    dir,
    listSessions() {
      const now = Date.now();
      if (cachedSessions && now - cachedAt < cacheTtlMs) return cachedSessions;
      cachedSessions = readSessionIndexSync(dir);
      cachedAt = now;
      return cachedSessions;
    },
    hasSession(sessionId) {
      return typeof sessionId === 'string' && existsSync(join(dir, `${sessionId}.jsonl`));
    },
    readSessionEvents(sessionId) {
      return readSessionEventsSync(dir, sessionId);
    },
    readSessionMeta(sessionId) {
      return this.listSessions().find((session) => session.id === sessionId) ?? null;
    },
    invalidate() {
      cachedSessions = null;
      cachedAt = 0;
    },
  };
}

function readSessionIndexSync(dir) {
  const byId = new Map();
  readLegacyIndex(dir, byId);
  readSidecars(dir, byId);
  readLogFiles(dir, byId);
  return [...byId.values()]
    .filter((meta) => existsSync(join(dir, `${meta.id}.jsonl`)))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

function readLegacyIndex(dir, byId) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    if (!Array.isArray(parsed)) return;
    for (const candidate of parsed) {
      const meta = normalizeSessionMeta(candidate);
      if (meta) byId.set(meta.id, meta);
    }
  } catch {
    // Optional legacy file.
  }
}

function readSidecars(dir, byId) {
  let files;
  try {
    files = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.meta.json')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file.name), 'utf8'));
      const meta = normalizeSessionMeta(parsed);
      if (meta) byId.set(meta.id, meta);
    } catch {
      // Skip malformed or half-written sidecars.
    }
  }
}

function readLogFiles(dir, byId) {
  let files;
  try {
    files = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
    const id = file.name.slice(0, -'.jsonl'.length);
    const current = byId.get(id) ?? null;
    const events = readSessionEventsSync(dir, id);
    const derived = deriveSessionMetaFromEvents(dir, id, current, events);
    if (derived) byId.set(id, derived);
  }
}

function readSessionEventsSync(dir, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return [];
  let raw;
  try {
    raw = readFileSync(join(dir, `${sessionId}.jsonl`), 'utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Keep the readable part of the conversation.
    }
  }
  return events;
}

function deriveSessionMetaFromEvents(dir, sessionId, current, events) {
  if (events.length === 0 && current) return current;
  const fallbackTime = fileMtimeIso(dir, sessionId);
  const firstPrompt = current?.firstPrompt ?? firstPromptFromEvents(events) ?? null;
  const firstEventTime = firstEventTimeFromEvents(events) ?? current?.startedAt ?? fallbackTime;
  const lastEventTime = latestEventTimeFromEvents(events) ?? current?.lastActivity ?? fallbackTime;
  const eventCount = Math.max(current?.eventCount ?? 0, events.length);
  if (!current && events.length === 0) return null;
  return {
    id: current?.id ?? sessionId,
    cwd: current?.cwd ?? '',
    startedAt: current?.startedAt ?? firstEventTime,
    lastActivity: latestIso(current?.lastActivity, lastEventTime),
    eventCount,
    firstPrompt,
    provider: current?.provider ?? null,
    model: current?.model ?? null,
  };
}

function normalizeSessionMeta(value) {
  if (!value || typeof value !== 'object') return null;
  const meta = value;
  if (
    typeof meta.id !== 'string' ||
    typeof meta.cwd !== 'string' ||
    typeof meta.startedAt !== 'string' ||
    typeof meta.lastActivity !== 'string' ||
    typeof meta.eventCount !== 'number'
  ) {
    return null;
  }
  return {
    id: meta.id,
    cwd: meta.cwd,
    startedAt: meta.startedAt,
    lastActivity: meta.lastActivity,
    eventCount: meta.eventCount,
    firstPrompt: typeof meta.firstPrompt === 'string' ? meta.firstPrompt : null,
    provider: typeof meta.provider === 'string' ? meta.provider : null,
    model: typeof meta.model === 'string' ? meta.model : null,
  };
}

function firstPromptFromEvents(events) {
  const prompt = events.find((event) => event?.type === 'user_prompt' && typeof event.text === 'string');
  return prompt?.text?.slice?.(0, 80) ?? null;
}

function firstEventTimeFromEvents(events) {
  for (const event of events) {
    const time = eventTimeIso(event);
    if (time) return time;
  }
  return null;
}

function latestEventTimeFromEvents(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const time = eventTimeIso(events[index]);
    if (time) return time;
  }
  return null;
}

function eventTimeIso(event) {
  const ts = event?.ts;
  if (typeof ts === 'number' && Number.isFinite(ts)) return new Date(ts).toISOString();
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function latestIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function fileMtimeIso(dir, sessionId) {
  try {
    return statSync(join(dir, `${sessionId}.jsonl`)).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}
