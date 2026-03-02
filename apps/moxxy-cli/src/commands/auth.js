/**
 * Auth commands: token create, list, revoke.
 * Supports both interactive and non-interactive (flag-based) modes.
 */
import * as readline from 'node:readline';

const VALID_SCOPES = [
  'agents:read', 'agents:write', 'runs:write',
  'vault:read', 'vault:write', 'tokens:admin', 'events:read',
];

/**
 * Interactive prompt helper.
 */
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Parse --flag=value and --flag value style args.
 */
export function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[arg.slice(2)] = args[i + 1];
        i++;
      } else {
        flags[arg.slice(2)] = 'true';
      }
    }
  }
  return flags;
}

/**
 * Create a token - interactive or via flags.
 */
export async function tokenCreate(client, args) {
  const flags = parseFlags(args);
  let scopes;
  let ttl = null;
  let description = '';

  if (flags.scopes !== undefined) {
    // Non-interactive mode
    scopes = flags.scopes.split(',').map(s => s.trim()).filter(Boolean);
    ttl = flags.ttl ? parseInt(flags.ttl, 10) : null;
    description = flags.description || '';
  } else {
    // Interactive mode
    console.error('Available scopes: ' + VALID_SCOPES.join(', '));
    const scopeInput = await prompt('Scopes (comma-separated): ');
    scopes = scopeInput.split(',').map(s => s.trim()).filter(Boolean);
    const ttlInput = await prompt('TTL in seconds (empty for none): ');
    ttl = ttlInput ? parseInt(ttlInput, 10) : null;
    description = await prompt('Description: ');
  }

  // Validate scopes
  const invalid = scopes.filter(s => !VALID_SCOPES.includes(s));
  if (invalid.length > 0) {
    throw new Error(`Invalid scopes: ${invalid.join(', ')}`);
  }
  if (scopes.length === 0) {
    throw new Error('At least one scope is required');
  }

  const result = await client.createToken(scopes, ttl, description);

  if (flags.json === 'true' || flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Token created: ${result.id}`);
    if (result.token) {
      console.log(`Secret: ${result.token}`);
      console.log('(Save this - it will not be shown again)');
    }
  }
  return result;
}

/**
 * List tokens.
 */
export async function tokenList(client, args) {
  const flags = parseFlags(args);
  const tokens = await client.listTokens();

  if (flags.json === 'true') {
    console.log(JSON.stringify(tokens, null, 2));
  } else {
    if (!tokens || tokens.length === 0) {
      console.log('No tokens found.');
      return tokens;
    }
    for (const t of tokens) {
      const status = t.status || 'active';
      const expires = t.expires_at || 'never';
      console.log(`  ${t.id}  scopes=[${(t.scopes || []).join(',')}]  status=${status}  expires=${expires}`);
    }
  }
  return tokens;
}

/**
 * Revoke a token.
 */
export async function tokenRevoke(client, args) {
  const id = args[0];
  if (!id) {
    throw new Error('Usage: moxxy auth token revoke <id>');
  }
  await client.revokeToken(id);
  console.log(`Token ${id} revoked.`);
}

/**
 * Route auth subcommands.
 */
export async function authCommand(client, args) {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case 'token': {
      const action = rest[0];
      const actionArgs = rest.slice(1);
      switch (action) {
        case 'create':
          return tokenCreate(client, actionArgs);
        case 'list':
          return tokenList(client, actionArgs);
        case 'revoke':
          return tokenRevoke(client, actionArgs);
        default:
          console.error('Usage: moxxy auth token <create|list|revoke>');
          process.exitCode = 1;
      }
      break;
    }
    default:
      console.error('Usage: moxxy auth token <create|list|revoke>');
      process.exitCode = 1;
  }
}

export { VALID_SCOPES };
