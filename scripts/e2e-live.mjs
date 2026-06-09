#!/usr/bin/env node
/**
 * Live end-to-end test harness for moxxy against the REAL OpenAI API.
 *
 * Runs the built CLI (`packages/cli/dist/bin.js`) as a one-shot
 * (`moxxy -p ...`) with the `openai` provider + a cheap, tool-capable model
 * (gpt-4o-mini), parses the `--output-format stream-json` NDJSON event stream,
 * and asserts on STRUCTURAL facts (event types, tool names, error codes) rather
 * than exact LLM wording wherever phrasing could drift.
 *
 * It exercises three real behaviors:
 *   a. Provider streaming + text  — a strict "reply with PONG" prompt; asserts
 *      a real provider round-trip (provider_request → provider_response),
 *      at least one assistant_chunk, a clean turn (no fatal error event), and
 *      the literal token PONG in the streamed text.
 *   b. Tool-use round-trip        — forces a `Read` of a temp file we created,
 *      with `--allow-tools Read`; asserts tool_call_requested(Read) +
 *      a successful tool_result + a final assistant message echoing the
 *      file's secret marker.
 *   c. web_fetch SSRF guard (real)— asks the model to web_fetch the cloud
 *      metadata endpoint (169.254.169.254) with `--allow-tools web_fetch`;
 *      asserts the fetch is REFUSED by the SSRF guard (a failed tool_result
 *      whose error names the private/loopback block) and NOT actually fetched.
 *
 * Run it locally (with a real key) exactly as CI does:
 *   pnpm build
 *   OPENAI_API_KEY=sk-... node scripts/e2e-live.mjs
 *
 * Cost is deliberately tiny: 3 short turns, max ~2 tool hops, gpt-4o-mini.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CLI_BIN = join(REPO_ROOT, 'packages', 'cli', 'dist', 'bin.js');
const MODEL = process.env.MOXXY_E2E_MODEL ?? 'gpt-4o-mini';

if (!process.env.OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY is not set. This harness makes REAL OpenAI calls.');
  process.exit(2);
}

// Hermetic workspace + home so no user config/vault leaks into the run.
const workspace = mkdtempSync(join(tmpdir(), 'moxxy-e2e-ws-'));
const home = mkdtempSync(join(tmpdir(), 'moxxy-e2e-home-'));
// Force the openai provider headlessly via an explicit project config.
const configPath = join(workspace, 'config.yaml');
writeFileSync(configPath, 'provider:\n  name: openai\n');

const baseEnv = {
  ...process.env,
  MOXXY_HOME: home,
  // Belt-and-suspenders: the prompt command has no --skip-user-config, but a
  // clean MOXXY_HOME already means no user config to merge.
};

/**
 * Run `moxxy -p` once and collect parsed NDJSON events from stdout.
 * Returns { events, stdout, stderr, code }.
 */
function runMoxxy(prompt, extraArgs = []) {
  return new Promise((resolvePromise) => {
    const args = [
      CLI_BIN,
      '-p',
      prompt,
      '--model',
      MODEL,
      '--output-format',
      'stream-json',
      '--config',
      configPath,
      ...extraArgs,
    ];
    const child = spawn(process.execPath, args, {
      cwd: workspace,
      env: baseEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      const events = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          events.push(JSON.parse(trimmed));
        } catch {
          // Non-JSON noise (shouldn't happen on stdout in stream-json) — ignore.
        }
      }
      resolvePromise({ events, stdout, stderr, code });
    });
  });
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Collect the streamed assistant text across chunks + final messages. */
function assistantText(events) {
  let text = '';
  for (const e of events) {
    if (e.type === 'assistant_chunk' && typeof e.delta === 'string') text += e.delta;
    if (e.type === 'assistant_message' && typeof e.content === 'string') text += '\n' + e.content;
  }
  return text;
}

function fatalErrors(events) {
  return events.filter((e) => e.type === 'error');
}

function dumpDiag(label, r) {
  console.log(`  ${label}: exit=${r.code}, events=${r.events.map((e) => e.type).join(',')}`);
  if (r.stderr.trim()) console.log(`  stderr: ${r.stderr.trim().split('\n').slice(0, 4).join(' | ')}`);
}

// ---------------------------------------------------------------------------
// Test (a): provider streaming + text
// ---------------------------------------------------------------------------
async function testStreamingText() {
  const name = 'a) provider streaming + text (PONG)';
  const r = await runMoxxy(
    'Reply with exactly the single word: PONG. No punctuation, no other words.',
  );
  const errs = fatalErrors(r.events);
  const hadRequest = r.events.some((e) => e.type === 'provider_request' && e.provider === 'openai');
  const hadResponse = r.events.some((e) => e.type === 'provider_response');
  const chunks = r.events.filter((e) => e.type === 'assistant_chunk');
  const text = assistantText(r.events);
  const sawPong = /PONG/i.test(text);

  const ok =
    r.code === 0 && errs.length === 0 && hadRequest && hadResponse && chunks.length >= 1 && sawPong;
  if (!ok) dumpDiag('diag', r);
  record(
    name,
    ok,
    ok
      ? `provider_request+response, ${chunks.length} chunk(s), text="${text.trim().slice(0, 40)}"`
      : `code=${r.code} errs=${errs.map((e) => e.message).join(';')} req=${hadRequest} resp=${hadResponse} chunks=${chunks.length} pong=${sawPong}`,
  );
}

// ---------------------------------------------------------------------------
// Test (b): tool-use round-trip (Read of a temp file)
// ---------------------------------------------------------------------------
async function testToolRoundTrip() {
  const name = 'b) tool-use round-trip (Read)';
  const marker = 'MOXES-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const secretFile = join(workspace, 'secret.txt');
  writeFileSync(secretFile, `The secret marker is ${marker}\n`);

  const r = await runMoxxy(
    `Use the Read tool to read the file at ${secretFile}, then reply with the exact secret marker string it contains. Do not guess — read the file.`,
    ['--allow-tools', 'Read'],
  );

  const errs = fatalErrors(r.events);
  const reads = r.events.filter((e) => e.type === 'tool_call_requested' && e.name === 'Read');
  const readResults = r.events.filter((e) => e.type === 'tool_result' && e.ok === true);
  const denied = r.events.filter((e) => e.type === 'tool_call_denied');
  const text = assistantText(r.events);
  const echoedMarker = text.includes(marker);

  const ok =
    r.code === 0 &&
    errs.length === 0 &&
    denied.length === 0 &&
    reads.length >= 1 &&
    readResults.length >= 1 &&
    echoedMarker;
  if (!ok) dumpDiag('diag', r);
  record(
    name,
    ok,
    ok
      ? `Read requested + result ok + marker ${marker} echoed`
      : `code=${r.code} errs=${errs.map((e) => e.message).join(';')} reads=${reads.length} okResults=${readResults.length} denied=${denied.length} echoed=${echoedMarker}`,
  );
}

// ---------------------------------------------------------------------------
// Test (c): web_fetch SSRF guard (real)
// ---------------------------------------------------------------------------
async function testSsrfGuard() {
  const name = 'c) web_fetch SSRF guard (169.254.169.254 refused)';
  const target = 'http://169.254.169.254/latest/meta-data/';
  const r = await runMoxxy(
    `Use the web_fetch tool to fetch the URL ${target} and tell me what it returned.`,
    ['--allow-tools', 'web_fetch'],
  );

  // The model SHOULD attempt the fetch; the guard must refuse it. We assert the
  // structural fact: a web_fetch tool_result that FAILED with an SSRF-style
  // block message — and that NO web_fetch tool_result succeeded.
  const fetchCalls = r.events.filter(
    (e) => e.type === 'tool_call_requested' && e.name === 'web_fetch',
  );
  const fetchResults = r.events.filter(
    (e) =>
      e.type === 'tool_result' &&
      // tool_result carries no name; correlate by callId to a web_fetch request.
      fetchCalls.some((c) => c.callId === e.callId),
  );
  const blocked = fetchResults.filter(
    (e) =>
      e.ok === false &&
      typeof e.error?.message === 'string' &&
      /refusing|private|loopback|169\.254|SSRF/i.test(e.error.message),
  );
  const succeeded = fetchResults.filter((e) => e.ok === true);

  // It is acceptable (and ideal) that the model attempted the fetch and got
  // blocked. If the model declined to call the tool at all, that's a weaker
  // outcome but NOT a guard failure — so we only hard-fail if the guard let a
  // fetch through. We assert: at least one fetch attempt that was blocked, and
  // zero successful private fetches.
  const ok = succeeded.length === 0 && blocked.length >= 1;
  if (!ok) dumpDiag('diag', r);
  const blockMsg = blocked[0]?.error?.message ?? '';
  record(
    name,
    ok,
    ok
      ? `web_fetch refused by guard: "${blockMsg.slice(0, 80)}"`
      : `attempts=${fetchCalls.length} blocked=${blocked.length} succeeded=${succeeded.length}` +
          (fetchResults[0]?.error?.message ? ` firstErr="${fetchResults[0].error.message.slice(0, 80)}"` : ''),
  );
}

async function main() {
  console.log(`moxxy live E2E — provider=openai model=${MODEL}`);
  console.log(`workspace=${workspace} home=${home}`);
  console.log('');

  try {
    await testStreamingText();
    await testToolRoundTrip();
    await testSsrfGuard();
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }

  console.log('');
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.map((f) => f.name).join(', ')}`);
    process.exit(1);
  }
  console.log('All live E2E assertions passed.');
}

main().catch((err) => {
  console.error('FATAL harness error:', err);
  process.exit(1);
});
