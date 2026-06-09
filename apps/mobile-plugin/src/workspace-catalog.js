import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function defaultDesksPath() {
  return join(homedir(), '.moxxy', 'desktop', 'desks.json');
}

export function createWorkspaceCatalog(options = {}) {
  const desksPath = options.desksPath ?? defaultDesksPath();
  const cacheTtlMs = typeof options.cacheTtlMs === 'number' ? options.cacheTtlMs : 1000;
  let cachedDesks = null;
  let cachedAt = 0;

  return {
    resolve(cwd) {
      const normalized = normalizeCwd(cwd);
      return listDesks().find((candidate) => normalizeCwd(candidate.cwd) === normalized) ?? null;
    },
    list() {
      return listDesks();
    },
  };

  function listDesks() {
    const now = Date.now();
    if (cachedDesks && now - cachedAt < cacheTtlMs) return cachedDesks;
    cachedDesks = readDesks(desksPath);
    cachedAt = now;
    return cachedDesks;
  }
}

function readDesks(desksPath) {
  try {
    const parsed = JSON.parse(readFileSync(desksPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.desks)) return [];
    return parsed.desks
      .filter(isDesk)
      .map((desk) => ({
        id: desk.id,
        name: desk.name,
        cwd: normalizeCwd(desk.cwd),
        color: desk.color,
      }));
  } catch {
    return [];
  }
}

function isDesk(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.id === 'string' &&
      typeof value.name === 'string' &&
      typeof value.cwd === 'string' &&
      typeof value.color === 'string',
  );
}

function normalizeCwd(cwd) {
  return typeof cwd === 'string' && cwd.length > 0 ? resolve(cwd) : '';
}
