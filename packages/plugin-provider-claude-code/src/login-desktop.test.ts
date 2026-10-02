import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { posixShell } from '@moxxy/vitest-preset/platform';
import type { ProviderAuthContext } from '@moxxy/sdk';
import { claudeLogin } from './login.js';

// A stand-in for the installed `claude` binary, speaking the same non-TTY login
// dialogue: it prints the sign-in URL and a paste prompt, then either finishes
// on its own (the browser's localhost callback) or waits for a pasted code.
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const marker = path.join(__dirname, 'signed-in');
const [, , group, command] = process.argv;
if (group === 'auth' && command === 'status') {
  console.log(JSON.stringify({ loggedIn: fs.existsSync(marker), email: 'me@example.com' }));
  process.exit(0);
}
if (group === 'auth' && command === 'login') {
  process.stdout.write('Opening browser to sign in…\\n');
  process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\\n");
  process.stdout.write('Paste code here if prompted > ');
  if (process.env.FAKE_CLAUDE_CALLBACK === '1') {
    fs.writeFileSync(marker, '');
    process.exit(0);
  }
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
    if (!input.includes('\\n')) return;
    if (input.trim() !== 'code#state') process.exit(3);
    fs.writeFileSync(marker, '');
    process.exit(0);
  });
}
`;

const dirs: string[] = [];

afterEach(async () => {
  delete process.env.FAKE_CLAUDE_CALLBACK;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fakeClaude(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'moxxy-claude-login-'));
  dirs.push(dir);
  const executable = join(dir, 'claude');
  await writeFile(executable, FAKE_CLAUDE, 'utf8');
  await chmod(executable, 0o755);
  return executable;
}

/** The context `moxxy login --stdin-prompts` hands a provider when the desktop drives it. */
function desktopContext(executable: string, answer: () => Promise<string>) {
  const output: string[] = [];
  const questions: string[] = [];
  const ctx: ProviderAuthContext = {
    headless: false,
    noOpen: true,
    providerConfig: { executable },
    write: (chunk) => { output.push(chunk); },
    onAuthUrl: () => {},
    prompt: async (question) => {
      questions.push(question);
      return await answer();
    },
    vault: { get: async () => null, set: async () => {}, delete: async () => false },
  };
  return { ctx, output, questions };
}

describe('Claude sign-in driven from the desktop', () => {
  it.skipIf(!posixShell)('shows the CLI progress and hands the code pasted in the desktop to the CLI', async () => {
    const { ctx, output, questions } = desktopContext(await fakeClaude(), async () => 'code#state');

    await expect(claudeLogin(ctx)).resolves.toEqual({ accountId: 'me@example.com' });

    expect(output.join('')).toContain("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true");
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatch(/paste/i);
  });

  it.skipIf(!posixShell)('finishes when the browser completes the sign-in, without waiting for a pasted code', async () => {
    process.env.FAKE_CLAUDE_CALLBACK = '1';
    const { ctx } = desktopContext(await fakeClaude(), () => new Promise<string>(() => {}));

    await expect(claudeLogin(ctx)).resolves.toEqual({ accountId: 'me@example.com' });
  });
});
