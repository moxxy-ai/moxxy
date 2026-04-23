import { p } from '../ui.js';
import { startGateway, stopGateway, findBinary, paths } from './gateway.js';
import { execSync } from 'node:child_process';
import {
  existsSync, copyFileSync, renameSync, chmodSync, unlinkSync,
  createReadStream, createWriteStream, readFileSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const GITHUB_REPO = process.env.MOXXY_GITHUB_REPO || 'moxxy-ai/moxxy';
const GITHUB_API = 'https://api.github.com';

// --- Pure functions (exported for testing) ---

export function detectPlatform() {
  const osMap = { darwin: 'darwin', linux: 'linux' };
  const archMap = { arm64: 'arm64', x64: 'x86_64' };
  const os = osMap[platform()] || platform();
  const cpuArch = archMap[arch()] || arch();
  const binaryName = `moxxy-gateway-${os}-${cpuArch}`;
  return { os, arch: cpuArch, binaryName };
}

export function parseUpdateFlags(args) {
  const flags = { check: false, rollback: false, force: false, json: false };
  for (const arg of args) {
    if (arg === '--check') flags.check = true;
    else if (arg === '--rollback') flags.rollback = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--json') flags.json = true;
  }
  return flags;
}

export function compareVersions(current, latest) {
  const normalize = (v) => v.replace(/^v/, '').split('.').map(Number);
  const c = normalize(current);
  const l = normalize(latest);

  // Pad to equal length
  while (c.length < 3) c.push(0);
  while (l.length < 3) l.push(0);

  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return 'update-available';
    if (l[i] < c[i]) return 'newer';
  }
  return 'up-to-date';
}

export function parseChecksumFile(content) {
  const result = {};
  if (!content) return result;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: <64-hex-hash>  <filename> (two spaces between)
    const match = trimmed.match(/^([a-f0-9]{64})\s+(.+)$/);
    if (match) {
      result[match[2]] = match[1];
    }
  }
  return result;
}

export function findAssetUrl(assets, binaryName) {
  const asset = assets.find(a => a.name === binaryName);
  return asset ? asset.browser_download_url : null;
}

export function findChecksumUrl(assets) {
  const asset = assets.find(a => a.name === 'checksums.sha256');
  return asset ? asset.browser_download_url : null;
}

// --- Internal helpers ---

export async function getCurrentGatewayVersion(binPath) {
  // Try health endpoint first — this reports the version of the running process,
  // which is what we actually need to know for update decisions (the binary on
  // disk may have been replaced without a restart).
  const apiUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  let serverResponded = false;
  try {
    const resp = await fetch(`${apiUrl}/v1/health`, { signal: AbortSignal.timeout(2000) });
    serverResponded = true;
    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      if (data?.version) return data.version;
    }
  } catch { /* fetch failed — nothing listening, fall through to binary */ }

  // If something responded on the port but didn't give us a version, the
  // running gateway is stale (e.g. too old to expose /v1/health). Return null
  // so the caller treats it as "update required" rather than reading a newer
  // version from the on-disk binary that isn't actually running.
  if (serverResponded) return null;

  // Nothing running — fall back to binary --version so we can still compare.
  if (binPath && existsSync(binPath)) {
    try {
      const out = execSync(`"${binPath}" --version`, { encoding: 'utf-8', timeout: 5000 });
      const match = out.trim().match(/moxxy-gateway\s+(.+)/);
      if (match) return match[1];
    } catch { /* binary not executable or other error */ }
  }

  return null;
}

function getCurrentCliVersion() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return null;
  }
}

async function fetchLatestRelease() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'moxxy-cli' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`;
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });

  if (resp.status === 403) {
    const remaining = resp.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      throw new Error('GitHub API rate limit exceeded. Set GITHUB_TOKEN env var to increase the limit.');
    }
    throw new Error(`GitHub API returned 403: ${resp.statusText}`);
  }
  if (resp.status === 404) {
    throw new Error('No releases found. The project may not have published any releases yet.');
  }
  if (!resp.ok) {
    throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
  }

  return resp.json();
}

async function downloadFile(url, destPath) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { 'User-Agent': 'moxxy-cli', 'Accept': 'application/octet-stream' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);

  const fileStream = createWriteStream(destPath);
  await pipeline(resp.body, fileStream);
}

async function downloadText(url) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { 'User-Agent': 'moxxy-cli', 'Accept': 'application/octet-stream' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  return resp.text();
}

async function verifyChecksum(filePath, expectedHash) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      const actual = hash.digest('hex');
      resolve(actual === expectedHash);
    });
    stream.on('error', reject);
  });
}

async function healthCheckAfterUpdate() {
  const apiUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const resp = await fetch(`${apiUrl}/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) {
        const data = await resp.json();
        return { healthy: true, version: data.version || null };
      }
    } catch { /* retry */ }
  }
  return { healthy: false, version: null };
}

export async function isGatewayRunning() {
  // Any HTTP response — including 404 — means a process is bound to the port.
  // We must detect old gateways that don't expose /v1/health so the update
  // flow can stop and restart them; otherwise the new binary lands on disk
  // but the stale process keeps running.
  const apiUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  try {
    await fetch(`${apiUrl}/v1/health`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

// --- Rollback ---

async function runRollback(flags) {
  const { bin: binPath } = paths();
  const bakPath = binPath + '.bak';

  if (!existsSync(bakPath)) {
    p.log.error('No backup found. Cannot rollback (no .bak file exists).');
    process.exitCode = 1;
    return;
  }

  const wasRunning = await isGatewayRunning();

  if (wasRunning) {
    p.log.step('Stopping gateway...');
    try { await stopGateway(); } catch (e) { p.log.warn(`Failed to stop gateway: ${e.message}`); }
    await new Promise(r => setTimeout(r, 1000));
  }

  copyFileSync(bakPath, binPath);
  chmodSync(binPath, 0o755);
  p.log.success('Restored gateway binary from backup.');

  if (wasRunning) {
    p.log.step('Starting gateway...');
    try { await startGateway(); } catch (e) { p.log.warn(`Failed to start gateway: ${e.message}`); }
  }

  const health = await healthCheckAfterUpdate();
  if (health.healthy) {
    p.log.success(`Gateway healthy${health.version ? ` (v${health.version})` : ''}.`);
  } else if (wasRunning) {
    p.log.warn('Gateway health check failed after rollback.');
  }

  if (flags.json) {
    console.log(JSON.stringify({ rolled_back: true, healthy: health.healthy, version: health.version }));
  }
}

// --- Main update flow ---

export async function runUpdate(client, args) {
  const flags = parseUpdateFlags(args);

  if (flags.rollback) {
    await runRollback(flags);
    return;
  }

  const { binaryName } = detectPlatform();
  const binPath = findBinary();

  // Current versions
  const currentGateway = await getCurrentGatewayVersion(binPath);
  const currentCli = getCurrentCliVersion();

  // Fetch latest release
  let release;
  try {
    release = await fetchLatestRelease();
  } catch (err) {
    p.log.error(err.message);
    process.exitCode = 1;
    return;
  }

  const latestVersion = release.tag_name.replace(/^v/, '');

  // Compare
  const gatewayComparison = currentGateway
    ? compareVersions(currentGateway, latestVersion)
    : 'update-available';

  const cliComparison = currentCli
    ? compareVersions(currentCli, latestVersion)
    : 'update-available';

  // --check: just report
  if (flags.check) {
    if (flags.json) {
      console.log(JSON.stringify({
        current: { gateway: currentGateway, cli: currentCli },
        latest: latestVersion,
        gateway_status: gatewayComparison,
        cli_status: cliComparison,
      }));
    } else {
      p.log.info(`Current gateway: ${currentGateway || 'unknown'}`);
      p.log.info(`Current CLI:     ${currentCli || 'unknown'}`);
      p.log.info(`Latest release:  ${latestVersion}`);
      if (gatewayComparison === 'update-available' || cliComparison === 'update-available') {
        p.log.info('Update available! Run `moxxy update` to install.');
      } else {
        p.log.success('Everything is up to date.');
      }
    }
    return;
  }

  // Up-to-date check
  if (gatewayComparison === 'up-to-date' && cliComparison === 'up-to-date' && !flags.force) {
    p.log.success(`Already up to date (v${latestVersion}).`);
    return;
  }

  // --- Update gateway binary ---
  if (gatewayComparison === 'update-available' || flags.force) {
    const assetUrl = findAssetUrl(release.assets, binaryName);
    if (!assetUrl) {
      p.log.error(`No binary found for platform: ${binaryName}`);
      p.log.info('Available assets: ' + release.assets.map(a => a.name).join(', '));
      process.exitCode = 1;
      return;
    }

    // Checksum
    const checksumUrl = findChecksumUrl(release.assets);
    let expectedHash = null;
    if (checksumUrl) {
      try {
        const checksumContent = await downloadText(checksumUrl);
        const checksums = parseChecksumFile(checksumContent);
        expectedHash = checksums[binaryName] || null;
      } catch (e) {
        p.log.warn(`Could not download checksums: ${e.message}`);
      }
    } else {
      p.log.warn('No checksum file found in release. Skipping verification.');
    }

    const { bin: installPath } = paths();
    const tmpPath = installPath + '.download';

    // Download
    p.log.step(`Downloading ${binaryName}...`);
    try {
      await downloadFile(assetUrl, tmpPath);
    } catch (err) {
      try { unlinkSync(tmpPath); } catch { /* cleanup */ }
      p.log.error(`Download failed: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    // Verify checksum
    if (expectedHash) {
      const valid = await verifyChecksum(tmpPath, expectedHash);
      if (!valid) {
        try { unlinkSync(tmpPath); } catch { /* cleanup */ }
        p.log.error('Checksum verification failed. The download may be corrupted.');
        process.exitCode = 1;
        return;
      }
      p.log.success('Checksum verified.');
    }

    // Stop gateway if running
    const wasRunning = await isGatewayRunning();
    if (wasRunning) {
      p.log.step('Stopping gateway...');
      try { await stopGateway(); } catch (e) { p.log.warn(`Failed to stop gateway: ${e.message}`); }
      await new Promise(r => setTimeout(r, 1000));
    }

    // Backup + install
    if (existsSync(installPath)) {
      copyFileSync(installPath, installPath + '.bak');
    }
    renameSync(tmpPath, installPath);
    chmodSync(installPath, 0o755);
    p.log.success(`Gateway updated to v${latestVersion}.`);

    // Restart if it was running
    if (wasRunning) {
      p.log.step('Starting gateway...');
      try { await startGateway(); } catch (e) { p.log.warn(`Failed to start gateway: ${e.message}`); }

      const health = await healthCheckAfterUpdate();
      if (health.healthy) {
        p.log.success('Gateway is healthy.');
      } else {
        p.log.warn('Gateway health check failed. Run `moxxy update --rollback` to restore the previous version.');
      }
    }
  } else if (gatewayComparison !== 'update-available') {
    p.log.info(`Gateway already at v${currentGateway}.`);
  }

  // --- Update CLI ---
  if (cliComparison === 'update-available' || flags.force) {
    p.log.step('Updating CLI...');
    try {
      execSync(`npm install -g @moxxy/cli@${latestVersion}`, { stdio: 'pipe', timeout: 60000 });
      p.log.success(`CLI updated to v${latestVersion}.`);
    } catch (err) {
      p.log.warn(`CLI update failed. Install manually: npm install -g @moxxy/cli@${latestVersion}`);
    }
  } else if (cliComparison !== 'update-available') {
    p.log.info(`CLI already at v${currentCli}.`);
  }

  p.log.success('Update complete.');
}
