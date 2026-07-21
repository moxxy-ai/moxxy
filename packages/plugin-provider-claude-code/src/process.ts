import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface ClaudeSpawnOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
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
  readonly cwd: string;
  readonly nativeTools: boolean;
  readonly permissionMode?: string;
  readonly allowedTools: ReadonlyArray<string>;
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
    '--model',
    options.model,
  ];
  if (options.nativeTools) {
    if (options.permissionMode) args.push('--permission-mode', options.permissionMode);
    // An empty explicit allow-list means no tools, not unrestricted native tools.
    args.push('--allowedTools', ...options.allowedTools);
  } else {
    // Keep the original subscription transport text-only unless native tools
    // were deliberately enabled in the provider item config.
    args.splice(args.length - 2, 0, '--tools', '');
  }
  const env = { ...process.env };
  const spawnImpl = options.spawn ?? ((file, childArgs, childOptions) => spawn(file, [...childArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childOptions.env,
    cwd: childOptions.cwd,
  }));
  const child = spawnImpl(options.executable, args, { env, cwd: options.cwd });
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
