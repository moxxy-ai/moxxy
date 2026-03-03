/**
 * Uninstall command: remove all Moxxy data from the system.
 * Removes ~/.moxxy (database, agents, config) but does NOT remove the npm package.
 */
import { p, handleCancel } from '../ui.js';
import { LOGO } from '../cli.js';
import { getMoxxyHome } from './init.js';
import { shellUnsetInstruction, shellProfileName } from '../platform.js';
import { existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

export async function runUninstall(client, args) {
  console.log(LOGO);
  p.intro('Uninstall Moxxy');

  const moxxyHome = getMoxxyHome();

  // ── 1. Show what will be removed ──

  const items = [];

  if (existsSync(moxxyHome)) {
    const size = getDirSize(moxxyHome);
    items.push(`${moxxyHome}  (${formatBytes(size)})`);

    // List contents for visibility
    if (existsSync(join(moxxyHome, 'moxxy.db'))) {
      items.push('  - Database (moxxy.db)');
    }
    if (existsSync(join(moxxyHome, 'agents'))) {
      const agents = readdirSync(join(moxxyHome, 'agents'));
      items.push(`  - ${agents.length} agent workspace(s)`);
    }
    if (existsSync(join(moxxyHome, 'config'))) {
      items.push('  - Configuration files');
    }
  } else {
    p.log.info(`Moxxy home not found at ${moxxyHome}. Nothing to remove.`);
  }

  // Check for running gateway
  let gatewayRunning = false;
  try {
    const resp = await fetch(`${client.baseUrl}/v1/providers`);
    if (resp) gatewayRunning = true;
  } catch {
    // Not running
  }

  if (gatewayRunning) {
    p.log.warn('Gateway is currently running. It should be stopped first.');
  }

  if (items.length === 0 && !gatewayRunning) {
    p.outro('Nothing to uninstall.');
    return;
  }

  // ── 2. Show removal summary ──

  if (items.length > 0) {
    p.note(items.join('\n'), 'The following will be permanently deleted');
  }

  // ── 3. Confirm ──

  const confirmed = await p.confirm({
    message: 'Are you sure you want to remove all Moxxy data? This cannot be undone.',
    initialValue: false,
  });
  handleCancel(confirmed);

  if (!confirmed) {
    p.outro('Uninstall cancelled.');
    return;
  }

  // Double confirmation for safety
  const reallyConfirmed = await p.confirm({
    message: 'Really delete everything? Type Yes to confirm.',
    initialValue: false,
  });
  handleCancel(reallyConfirmed);

  if (!reallyConfirmed) {
    p.outro('Uninstall cancelled.');
    return;
  }

  // ── 4. Stop gateway if running ──

  if (gatewayRunning) {
    p.log.step('Stopping gateway...');
    try {
      if (platform() === 'win32') {
        // Windows: use netstat + taskkill
        const out = execSync('netstat -ano | findstr :3000', { encoding: 'utf-8', stdio: 'pipe' }).trim();
        const pids = new Set();
        for (const line of out.split('\n').filter(Boolean)) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0') pids.add(pid);
        }
        for (const pid of pids) {
          try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' }); } catch { /* already dead */ }
        }
        if (pids.size > 0) p.log.success('Gateway stopped.');
      } else {
        // Unix: use lsof
        const pids = execSync("lsof -ti:3000 2>/dev/null || true", { encoding: 'utf-8' }).trim();
        if (pids) {
          for (const pid of pids.split('\n').filter(Boolean)) {
            try { process.kill(parseInt(pid), 'SIGTERM'); } catch { /* already dead */ }
          }
          p.log.success('Gateway stopped.');
        }
      }
    } catch {
      p.log.warn('Could not stop gateway automatically. Please stop it manually.');
    }
  }

  // ── 5. Remove ~/.moxxy ──

  if (existsSync(moxxyHome)) {
    try {
      rmSync(moxxyHome, { recursive: true, force: true });
      p.log.success(`Removed ${moxxyHome}`);
    } catch (err) {
      p.log.error(`Failed to remove ${moxxyHome}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
  }

  // ── 6. Clean environment reminder ──

  const envVars = ['MOXXY_TOKEN', 'MOXXY_API_URL', 'MOXXY_HOME'].filter(v => process.env[v]);

  const instructions = [];
  if (envVars.length > 0) {
    instructions.push(`Remove these from ${shellProfileName()}:`);
    for (const v of envVars) {
      instructions.push(`  ${shellUnsetInstruction(v)}`);
    }
  }
  instructions.push('');
  instructions.push('To remove the CLI itself:');
  instructions.push('  npm uninstall -g moxxy-cli');

  p.note(instructions.join('\n'), 'Manual cleanup');

  p.outro('Moxxy has been uninstalled. Goodbye!');
}

function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        try { size += statSync(fullPath).size; } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return size;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
