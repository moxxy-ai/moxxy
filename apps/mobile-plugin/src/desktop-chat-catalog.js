import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultDesktopChatsDir() {
  return join(homedir(), '.moxxy', 'chats');
}

export function createDesktopChatCatalog(options = {}) {
  const dir = options.dir ?? defaultDesktopChatsDir();
  const workspaceCatalog = options.workspaceCatalog;
  const cacheTtlMs = typeof options.cacheTtlMs === 'number' ? options.cacheTtlMs : 1000;
  let cachedSessions = null;
  let cachedAt = 0;

  return {
    dir,
    listSessions() {
      const now = Date.now();
      if (cachedSessions && now - cachedAt < cacheTtlMs) return cachedSessions;
      cachedSessions = readDesktopChatSessions(dir, workspaceCatalog?.list?.() ?? []);
      cachedAt = now;
      return cachedSessions;
    },
    hasSession(sessionId) {
      return typeof sessionId === 'string' && existsSync(join(dir, `${sessionId}.jsonl`));
    },
    readSessionEvents(sessionId) {
      return readDesktopChatEvents(dir, sessionId);
    },
    appendSessionEvent(sessionId, event) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      appendFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8');
      cachedSessions = null;
    },
  };
}

export function createEmptyDesktopChatCatalog() {
  return {
    dir: '',
    listSessions() {
      return [];
    },
    hasSession() {
      return false;
    },
    readSessionEvents() {
      return [];
    },
    appendSessionEvent() {
      return undefined;
    },
  };
}

function readDesktopChatSessions(dir, workspaces) {
  return workspaces
    .map((workspace) => desktopChatMeta(dir, workspace))
    .filter((meta) => meta !== null);
}

function desktopChatMeta(dir, workspace) {
  if (!workspace || typeof workspace.id !== 'string') return null;
  const events = readDesktopChatEvents(dir, workspace.id);
  if (events.length === 0) return null;
  const fallbackTime = fileMtimeIso(dir, workspace.id);
  return {
    id: workspace.id,
    cwd: typeof workspace.cwd === 'string' ? workspace.cwd : '',
    startedAt: firstEventTimeFromEvents(events) ?? fallbackTime,
    lastActivity: latestEventTimeFromEvents(events) ?? fallbackTime,
    eventCount: events.length,
    firstPrompt: firstPromptFromEvents(events),
    provider: null,
    model: null,
    desktopWorkspace: true,
  };
}

function readDesktopChatEvents(dir, sessionId) {
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
      // Preserve the readable portion of the desktop chat log.
    }
  }
  return events;
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

function fileMtimeIso(dir, sessionId) {
  try {
    return statSync(join(dir, `${sessionId}.jsonl`)).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}
