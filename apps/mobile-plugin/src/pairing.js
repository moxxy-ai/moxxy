import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 17902;

export class PairingStore {
  #code;
  #tokens = new Set();
  #tokenFactory;

  constructor(options = {}) {
    this.#code = options.code ?? generatePairingCode();
    this.#tokenFactory = options.tokenFactory ?? (() => `mg_${randomBytes(24).toString('base64url')}`);
  }

  get code() {
    return this.#code;
  }

  pairingInfo(url) {
    const payload = {
      type: 'moxxy-mobile-gateway',
      version: 1,
      url,
      code: this.#code,
    };
    return {
      code: this.#code,
      url,
      lanUrl: url,
      qrPayload: JSON.stringify(payload),
    };
  }

  consumeCode(code) {
    if (code !== this.#code) return null;
    const token = this.#tokenFactory();
    this.#tokens.add(token);
    this.#code = generatePairingCode();
    return { token };
  }

  isAuthorized(token) {
    return typeof token === 'string' && this.#tokens.has(token);
  }
}

export function publicMobileUrl(req) {
  const hostHeader = req.headers.host;
  const lanHost = firstLanAddress() ?? DEFAULT_HOST;
  const portPart = hostHeader?.includes(':') ? hostHeader.split(':').at(-1) : String(DEFAULT_PORT);
  return `http://${lanHost}:${portPart}/mobile/v1`;
}

function generatePairingCode() {
  return String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0');
}

function firstLanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return undefined;
}
