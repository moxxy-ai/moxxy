/**
 * Auth commands: token create/list/revoke.
 * Supports both interactive and non-interactive (flag-based) modes.
 */
import * as readline from 'node:readline';

const VALID_SCOPES = [
  'agents:read', 'agents:write', 'runs:write',
  'vault:read', 'vault:write', 'tokens:admin', 'events:read',
];

export function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const rest = arg.slice(2);
      const eqIdx = rest.indexOf('=');
      if (eqIdx !== -1) {
        flags[rest.slice(0, eqIdx)] = rest.slice(eqIdx + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[rest] = args[i + 1];
        i++;
      } else {
        flags[rest] = true;
      }
    }
  }
  return flags;
}

export function parseAuthCommand(args) {
  const [sub, action, ...rest] = args;
  const flags = parseFlags(rest);

  if (sub === 'token' && action === 'create') {
    const scopes = flags.scopes
      ? flags.scopes.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    return {
      action: 'create',
      scopes,
      ttl: flags.ttl ? parseInt(flags.ttl, 10) : undefined,
      description: flags.description,
      json: flags.json === true,
    };
  }

  if (sub === 'token' && action === 'list') {
    return { action: 'list', json: flags.json === true };
  }

  if (sub === 'token' && action === 'revoke') {
    return { action: 'revoke', id: rest[0] };
  }

  return { action: sub, sub: action };
}

export function buildTokenPayload(scopes, ttl) {
  const payload = { scopes };
  if (ttl !== undefined && ttl !== null) {
    payload.ttl_seconds = ttl;
  }
  return payload;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runAuth(client, args) {
  const parsed = parseAuthCommand(args);

  switch (parsed.action) {
    case 'create': {
      let scopes = parsed.scopes;
      let ttl = parsed.ttl;

      if (!scopes) {
        console.error('Available scopes: ' + VALID_SCOPES.join(', '));
        const input = await prompt('Scopes (comma-separated): ');
        scopes = input.split(',').map(s => s.trim()).filter(Boolean);
        const ttlInput = await prompt('TTL in seconds (empty for none): ');
        ttl = ttlInput ? parseInt(ttlInput, 10) : undefined;
      }

      const invalid = scopes.filter(s => !VALID_SCOPES.includes(s));
      if (invalid.length > 0) throw new Error(`Invalid scopes: ${invalid.join(', ')}`);
      if (scopes.length === 0) throw new Error('At least one scope is required');

      const payload = buildTokenPayload(scopes, ttl);
      const result = await client.request('/v1/auth/tokens', 'POST', payload);

      if (parsed.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Token created: ${result.id}`);
        if (result.token) console.log(`Secret: ${result.token}`);
      }
      return result;
    }

    case 'list': {
      const tokens = await client.request('/v1/auth/tokens', 'GET');
      if (parsed.json) {
        console.log(JSON.stringify(tokens, null, 2));
      } else {
        for (const t of (tokens || [])) {
          console.log(`  ${t.id}  scopes=[${(t.scopes || []).join(',')}]  status=${t.status || 'active'}`);
        }
      }
      return tokens;
    }

    case 'revoke': {
      if (!parsed.id) throw new Error('Usage: moxxy auth token revoke <id>');
      await client.request(`/v1/auth/tokens/${encodeURIComponent(parsed.id)}`, 'DELETE');
      console.log(`Token ${parsed.id} revoked.`);
      break;
    }

    default:
      console.error('Usage: moxxy auth token <create|list|revoke>');
      process.exitCode = 1;
  }
}

export async function tokenCreate(client, args) {
  const flags = parseFlags(args);
  const scopes = flags.scopes
    ? flags.scopes.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const invalid = scopes.filter(s => !VALID_SCOPES.includes(s));
  if (invalid.length > 0) throw new Error(`Invalid scopes: ${invalid.join(', ')}`);
  if (scopes.length === 0) throw new Error('At least one scope is required');

  const ttl = flags.ttl ? parseInt(flags.ttl, 10) : undefined;
  const payload = buildTokenPayload(scopes, ttl);
  const result = await client.request('/v1/auth/tokens', 'POST', payload);
  if (flags.json === 'true' || flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Token created: ${result.id}`);
    if (result.token) console.log(`Secret: ${result.token}`);
  }
  return result;
}

export async function tokenList(client, args) {
  const flags = parseFlags(args || []);
  const tokens = await client.request('/v1/auth/tokens', 'GET');
  if (flags.json === 'true' || flags.json === true) {
    console.log(JSON.stringify(tokens, null, 2));
  } else {
    for (const t of (tokens || [])) {
      console.log(`  ${t.id}  scopes=[${(t.scopes || []).join(',')}]  status=${t.status || 'active'}`);
    }
  }
  return tokens;
}

export async function tokenRevoke(client, id) {
  if (!id) throw new Error('Usage: moxxy auth token revoke <id>');
  await client.request(`/v1/auth/tokens/${encodeURIComponent(id)}`, 'DELETE');
  console.log(`Token ${id} revoked.`);
}

export { VALID_SCOPES };
