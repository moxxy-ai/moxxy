/**
 * Doctor command: diagnose the Moxxy installation.
 * Checks gateway, auth, providers, agents, storage, and environment.
 */
import { p, withSpinner } from '../ui.js';
import { getMoxxyHome } from './init.js';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export async function runDoctor(client, args) {
  p.intro('Moxxy Doctor');

  let pass = 0;
  let warn = 0;
  let fail = 0;

  function ok(msg) { p.log.success(msg); pass++; }
  function warning(msg) { p.log.warn(msg); warn++; }
  function error(msg) { p.log.error(msg); fail++; }

  // ── 1. Moxxy Home Directory ──

  const moxxyHome = getMoxxyHome();
  if (existsSync(moxxyHome)) {
    ok(`Moxxy home exists: ${moxxyHome}`);

    if (existsSync(join(moxxyHome, 'agents'))) {
      const agents = readdirSync(join(moxxyHome, 'agents'));
      ok(`Agents directory: ${agents.length} agent(s)`);
    } else {
      warning('Agents directory missing. Run: moxxy init');
    }

    if (existsSync(join(moxxyHome, 'config'))) {
      ok('Config directory exists');
    } else {
      warning('Config directory missing. Run: moxxy init');
    }

    const dbPath = join(moxxyHome, 'moxxy.db');
    if (existsSync(dbPath)) {
      const size = statSync(dbPath).size;
      ok(`Database: ${dbPath} (${formatBytes(size)})`);
    } else {
      warning('Database not found. Start the gateway to create it.');
    }
  } else {
    error(`Moxxy home not found: ${moxxyHome}`);
    p.log.info('  Run: moxxy init');
  }

  // ── 2. Environment Variables ──

  const apiUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  ok(`API URL: ${apiUrl}`);

  if (process.env.MOXXY_TOKEN) {
    const token = process.env.MOXXY_TOKEN;
    const masked = token.slice(0, 8) + '...' + token.slice(-4);
    ok(`API token set: ${masked}`);
  } else {
    warning('MOXXY_TOKEN not set. Some commands will fail.');
    p.log.info('  Run: moxxy init  or  moxxy auth token create');
  }

  // ── 3. Gateway Connectivity ──

  try {
    const resp = await fetch(`${apiUrl}/v1/providers`);
    if (resp) {
      ok(`Gateway reachable at ${apiUrl} (HTTP ${resp.status})`);
    }
  } catch {
    error(`Gateway not reachable at ${apiUrl}`);
    p.log.info('  Run: moxxy gateway start  or  cargo run -p moxxy-gateway');
  }

  // ── 4. Auth Check ──

  if (process.env.MOXXY_TOKEN) {
    try {
      await client.listTokens();
      ok('Authentication working');
    } catch (err) {
      if (err.status === 401) {
        error('Token is invalid or expired');
        p.log.info('  Run: moxxy auth token create');
      } else if (err.status === 403) {
        warning('Token lacks tokens:admin scope (auth check limited)');
      } else {
        warning(`Auth check inconclusive: ${err.message}`);
      }
    }
  }

  // ── 5. Providers ──

  try {
    const providers = await client.listProviders();
    if (Array.isArray(providers) && providers.length > 0) {
      ok(`Providers installed: ${providers.map(pr => pr.display_name || pr.id).join(', ')}`);
    } else {
      warning('No providers installed. Run: moxxy provider install');
    }
  } catch {
    // Skip if gateway/auth not available
  }

  // ── 6. Agents ──

  try {
    const agents = await client.listAgents();
    if (Array.isArray(agents) && agents.length > 0) {
      const running = agents.filter(a => a.status === 'running').length;
      ok(`Agents: ${agents.length} total, ${running} running`);
    } else {
      warning('No agents created. Run: moxxy agent create');
    }
  } catch {
    // Skip if gateway/auth not available
  }

  // ── 7. Rust Toolchain ──

  try {
    const rustVersion = execSync('rustc --version 2>/dev/null', { encoding: 'utf-8' }).trim();
    ok(`Rust: ${rustVersion}`);
  } catch {
    warning('Rust not found. Required to build/run the gateway.');
    p.log.info('  Install: https://rustup.rs');
  }

  // ── 8. Node.js Version ──

  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1));
  if (nodeMajor >= 22) {
    ok(`Node.js: ${nodeVersion}`);
  } else {
    error(`Node.js ${nodeVersion} is too old. Requires >= 22.0.0`);
  }

  // ── 9. API Key Environment Variables ──

  const apiKeys = [
    { env: 'ANTHROPIC_API_KEY', name: 'Anthropic' },
    { env: 'OPENAI_API_KEY', name: 'OpenAI' },
    { env: 'XAI_API_KEY', name: 'xAI' },
    { env: 'GOOGLE_API_KEY', name: 'Google' },
    { env: 'DEEPSEEK_API_KEY', name: 'DeepSeek' },
  ];

  const setKeys = apiKeys.filter(k => process.env[k.env]);
  if (setKeys.length > 0) {
    ok(`API keys found: ${setKeys.map(k => k.name).join(', ')}`);
  } else {
    warning('No provider API keys set in environment');
    p.log.info('  Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, ...');
  }

  // ── Summary ──

  const total = pass + warn + fail;
  p.note(
    `${pass}/${total} checks passed\n${warn} warning(s)\n${fail} error(s)`,
    fail === 0 ? 'All good' : 'Issues found',
  );

  if (fail === 0 && warn === 0) {
    p.outro('Moxxy is healthy!');
  } else if (fail === 0) {
    p.outro('Moxxy is working but has some warnings.');
  } else {
    p.outro('Fix the errors above to get Moxxy working.');
    process.exitCode = 1;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
