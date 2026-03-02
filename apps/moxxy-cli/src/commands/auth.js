/**
 * Auth commands: token create/list/revoke.
 * Supports both interactive and non-interactive (flag-based) modes.
 */
import { isInteractive, handleCancel, withSpinner, showResult, p } from '../ui.js';
import { resetTokens } from './init.js';

const VALID_SCOPES = [
  '*',
  'agents:read', 'agents:write', 'runs:write',
  'vault:read', 'vault:write', 'tokens:admin', 'events:read',
  'channels:read', 'channels:write',
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

export async function runAuth(client, args) {
  const parsed = parseAuthCommand(args);

  // Interactive sub-menu when no valid action
  if (!['create', 'list', 'revoke'].includes(parsed.action) && isInteractive()) {
    const action = await p.select({
      message: 'Auth action',
      options: [
        { value: 'create', label: 'Create token', hint: 'generate a new API token' },
        { value: 'list',   label: 'List tokens',  hint: 'show all tokens' },
        { value: 'revoke', label: 'Revoke token', hint: 'revoke an existing token' },
      ],
    });
    handleCancel(action);
    parsed.action = action;
  }

  switch (parsed.action) {
    case 'create': {
      let scopes = parsed.scopes;
      let ttl = parsed.ttl;

      if (!scopes && isInteractive()) {
        scopes = await p.multiselect({
          message: 'Select token scopes',
          options: VALID_SCOPES.map(s => ({ value: s, label: s })),
          required: true,
        });
        handleCancel(scopes);

        const ttlInput = await p.text({
          message: 'Token TTL in seconds',
          placeholder: 'leave empty for no expiry',
        });
        handleCancel(ttlInput);
        ttl = ttlInput ? parseInt(ttlInput, 10) : undefined;

        const descInput = await p.text({
          message: 'Token description',
          placeholder: 'optional',
        });
        handleCancel(descInput);
        parsed.description = descInput || undefined;
      }

      if (!scopes) {
        throw new Error('Scopes are required. Use --scopes or run interactively.');
      }

      const invalid = scopes.filter(s => !VALID_SCOPES.includes(s));
      if (invalid.length > 0) throw new Error(`Invalid scopes: ${invalid.join(', ')}`);
      if (scopes.length === 0) throw new Error('At least one scope is required');

      const payload = buildTokenPayload(scopes, ttl);
      if (parsed.description) payload.description = parsed.description;

      let result;
      if (isInteractive()) {
        // Try with current token first
        try {
          result = await withSpinner('Creating token...', () =>
            client.request('/v1/auth/tokens', 'POST', payload), 'Token created.');
        } catch (err) {
          if (err.status === 401 && isInteractive()) {
            p.log.warn('Authentication failed. Your token may be missing or invalid.');
            const recovery = await p.select({
              message: 'How would you like to proceed?',
              options: [
                { value: 'reset', label: 'Reset tokens', hint: 'clear all existing tokens and create a new one' },
                { value: 'paste', label: 'Paste a token', hint: 'use an existing valid token' },
                { value: 'abort', label: 'Abort' },
              ],
            });
            handleCancel(recovery);

            if (recovery === 'reset') {
              const confirm = await p.confirm({
                message: 'This will revoke ALL existing tokens. Continue?',
                initialValue: false,
              });
              handleCancel(confirm);
              if (confirm && resetTokens()) {
                p.log.success('All tokens cleared.');
                client.token = '';
                result = await withSpinner('Creating token...', () =>
                  client.request('/v1/auth/tokens', 'POST', payload), 'Token created.');
              } else if (confirm) {
                throw new Error('Could not reset tokens. Is sqlite3 installed?');
              } else {
                throw err;
              }
            } else if (recovery === 'paste') {
              const pastedToken = await p.text({
                message: 'Paste a valid API token',
                placeholder: 'mox_...',
              });
              handleCancel(pastedToken);
              if (pastedToken) {
                client.token = pastedToken;
                result = await withSpinner('Retrying...', () =>
                  client.request('/v1/auth/tokens', 'POST', payload), 'Token created.');
              } else {
                throw err;
              }
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }
        showResult('Your API Token', {
          ID: result.id,
          Token: result.token,
          Scopes: scopes.join(', '),
        });
        p.note(
          `# Add to ~/.zshrc or ~/.bashrc:\nexport MOXXY_TOKEN="${result.token}"`,
          'Save your token'
        );
        p.log.warn('This token will not be shown again. Save it now.');
      } else {
        result = await client.request('/v1/auth/tokens', 'POST', payload);
        if (parsed.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Token created: ${result.id}`);
          if (result.token) console.log(`Secret: ${result.token}`);
        }
      }
      return result;
    }

    case 'list': {
      let tokens;
      if (isInteractive()) {
        tokens = await withSpinner('Fetching tokens...', () =>
          client.request('/v1/auth/tokens', 'GET'), 'Tokens loaded.');
        for (const t of (tokens || [])) {
          p.log.info(`${t.id}  scopes=[${(t.scopes || []).join(',')}]  status=${t.status || 'active'}`);
        }
        if (!tokens || tokens.length === 0) {
          p.log.warn('No tokens found.');
        }
      } else {
        tokens = await client.request('/v1/auth/tokens', 'GET');
        if (parsed.json) {
          console.log(JSON.stringify(tokens, null, 2));
        } else {
          for (const t of (tokens || [])) {
            console.log(`  ${t.id}  scopes=[${(t.scopes || []).join(',')}]  status=${t.status || 'active'}`);
          }
        }
      }
      return tokens;
    }

    case 'revoke': {
      let id = parsed.id;

      if (!id && isInteractive()) {
        const tokens = await withSpinner('Fetching tokens...', () =>
          client.request('/v1/auth/tokens', 'GET'), 'Tokens loaded.');

        if (!tokens || tokens.length === 0) {
          p.log.warn('No tokens to revoke.');
          return;
        }

        id = await p.select({
          message: 'Select token to revoke',
          options: tokens.map(t => ({
            value: t.id,
            label: t.id,
            hint: `scopes=[${(t.scopes || []).join(',')}]`,
          })),
        });
        handleCancel(id);
      }

      if (!id) throw new Error('Usage: moxxy auth token revoke <id>');

      if (isInteractive()) {
        await withSpinner('Revoking token...', () =>
          client.request(`/v1/auth/tokens/${encodeURIComponent(id)}`, 'DELETE'), 'Token revoked.');
      } else {
        await client.request(`/v1/auth/tokens/${encodeURIComponent(id)}`, 'DELETE');
        console.log(`Token ${id} revoked.`);
      }
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
