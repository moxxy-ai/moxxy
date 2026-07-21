import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface ClaudeSpawnOptions {
  readonly env: NodeJS.ProcessEnv;
}

export type ClaudeSpawn = (
  executable: string,
  args: ReadonlyArray<string>,
  options: ClaudeSpawnOptions,
) => ChildProcessWithoutNullStreams;

export interface ClaudeProcessOptions {
  readonly executable: string;
  readonly model: string;
  readonly prompt: string;
  /** Optional moxxy-managed bearer passed only in the child's environment. */
  readonly oauthToken?: string;
  readonly signal?: AbortSignal;
  readonly spawn?: ClaudeSpawn;
}

export interface ClaudeProcessResult {
  readonly exitCode: number;
  readonly stderr: string;
}

const MAX_STDERR_CHARS = 2048;

export async function* runClaudeProcess(
  options: ClaudeProcessOptions,
): AsyncGenerator<string, ClaudeProcessResult> {
  const args = [
    '--print',
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--tools',
    '',
    '--model',
    options.model,
  ];
  const env = {
    ...process.env,
    ...(options.oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: options.oauthToken } : {}),
  };
  const spawnImpl = options.spawn ?? ((file, childArgs, childOptions) => spawn(file, [...childArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childOptions.env,
  }));
  const child = spawnImpl(options.executable, args, { env });
  const completion = waitForExit(child);
  let stderr = '';
  child.stdin.on('error', () => undefined);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.slice(0, MAX_STDERR_CHARS - stderr.length);
  });

  const abort = (): void => {
    child.kill('SIGTERM');
  };
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });

  child.stdin.end(options.prompt, 'utf8');
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim()) yield line;
    }
    const exitCode = await completion;
    return { exitCode, stderr: stderr.trim() };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}
