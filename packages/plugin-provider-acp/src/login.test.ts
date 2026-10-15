/** Sign-in, status and models come from the person's own `opencode` CLI; the CLI is the boundary stood in for here. */
import { afterEach, describe, expect, it } from 'vitest';
import { MoxxyError, type ProviderAuthContext } from '@moxxy/sdk';
import {
  __setOpenCodeCommandRunner,
  checkOpenCode,
  listOpenCodeModels,
  opencodeLogin,
  opencodeStatus,
  readOpenCodeMcpServers,
  readOpenCodeRules,
  resolveOpenCodeExecutable,
  type OpenCodeCommandResult,
} from './login.js';

const AUTH_LIST_ONE = '\u001b[0m\n┌  Credentials \u001b[90m~/.local/share/opencode/auth.json\n│\n●  OpenAI \u001b[90moauth\n│\n└  1 credentials\n';
const AUTH_LIST_NONE = '\u001b[0m\n┌  Credentials \u001b[90m~/.local/share/opencode/auth.json\n│\n└  0 credentials\n';
const MODELS = 'opencode/big-pickle\nopencode/space-bunny-free\nopenai/gpt-6-luna\n';

const calls: Array<{ executable: string; args: readonly string[]; inherit: boolean; cwd?: string }> = [];
function answer(results: Record<string, OpenCodeCommandResult>): void {
  __setOpenCodeCommandRunner(async (executable, args, options = {}) => {
    calls.push({ executable, args, inherit: options.inherit === true, ...(options.cwd ? { cwd: options.cwd } : {}) });
    const result = results[args.join(' ')];
    if (!result) throw new Error(`unexpected command: ${args.join(' ')}`);
    return result;
  });
}
const ok = (stdout: string): OpenCodeCommandResult => ({ code: 0, stdout, stderr: '' });
const missing: OpenCodeCommandResult = { code: 1, stdout: '', stderr: '', error: Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' }) };
const ctx = (over: Partial<ProviderAuthContext> = {}): ProviderAuthContext =>
  ({ vault: {} as never, headless: false, write: () => undefined, ...over }) as ProviderAuthContext;

afterEach(() => {
  calls.length = 0;
  delete process.env.OPENCODE_EXECUTABLE;
});

describe('OpenCode readiness', () => {
  it('is ready once installed, naming the providers it is signed in to', async () => {
    answer({ 'auth list': ok(AUTH_LIST_ONE) });

    expect(await checkOpenCode('opencode')).toEqual({
      state: 'signed-in',
      executable: 'opencode',
      accountId: 'OpenAI',
      message: 'OpenCode is ready, signed in to OpenAI.',
    });
  });

  it('is ready without any sign-in, since its free models need none', async () => {
    answer({ 'auth list': ok(AUTH_LIST_NONE) });

    const status = await checkOpenCode('opencode');

    expect(status.state).toBe('signed-in');
    expect(status.accountId).toBeUndefined();
    expect(status.message).toContain('opencode auth login');
  });

  it('says how to install OpenCode when it is missing', async () => {
    answer({ 'auth list': missing });

    expect(await checkOpenCode('opencode')).toMatchObject({ state: 'missing', message: expect.stringContaining('OPENCODE_EXECUTABLE') });
  });

  it('finds OpenCode through the provider config, then OPENCODE_EXECUTABLE, then PATH', () => {
    process.env.OPENCODE_EXECUTABLE = '/opt/opencode';
    expect(resolveOpenCodeExecutable({ executable: '/custom/opencode' })).toBe('/custom/opencode');
    expect(resolveOpenCodeExecutable({})).toBe('/opt/opencode');
    delete process.env.OPENCODE_EXECUTABLE;
    expect(resolveOpenCodeExecutable({})).toBe('opencode');
  });

  it('reports the status for the status surfaces', async () => {
    answer({ 'auth list': ok(AUTH_LIST_ONE) });

    expect(await opencodeStatus(ctx())).toEqual({ accountId: 'OpenAI', authState: 'signed-in', message: 'OpenCode is ready, signed in to OpenAI.' });
  });
});

describe('OpenCode models', () => {
  it('lists the models the person OpenCode offers', async () => {
    answer({ models: ok(`${MODELS}\n`) });

    expect(await listOpenCodeModels('opencode')).toEqual(['opencode/big-pickle', 'opencode/space-bunny-free', 'openai/gpt-6-luna']);
  });

  it('lists none when OpenCode cannot say', async () => {
    answer({ models: { code: 1, stdout: '', stderr: 'boom' } });

    expect(await listOpenCodeModels('opencode')).toEqual([]);
  });
});

describe('signing OpenCode in to a model provider', () => {
  it('hands the terminal to `opencode auth login`, where OpenCode asks which provider', async () => {
    answer({ 'auth list': ok(AUTH_LIST_ONE), 'auth login': ok('') });

    const result = await opencodeLogin(ctx());

    expect(calls.find((call) => call.args.join(' ') === 'auth login')).toMatchObject({ inherit: true });
    expect(result).toEqual({ accountId: 'OpenAI' });
  });

  it('asks a window without a terminal to have the person run it in a terminal', async () => {
    answer({ 'auth list': ok(AUTH_LIST_NONE) });

    await expect(opencodeLogin(ctx({ noOpen: true }))).rejects.toThrow(MoxxyError);
    await expect(opencodeLogin(ctx({ noOpen: true }))).rejects.toMatchObject({ hint: expect.stringContaining('opencode auth login') });
    expect(calls.some((call) => call.args.join(' ') === 'auth login')).toBe(false);
  });
});

describe('how the person OpenCode runs', () => {
  it('reads an agent rules in the conversation folder, where project config applies', async () => {
    const agent = { name: 'build', mode: 'primary', permission: [{ permission: '*', action: 'allow', pattern: '*' }, { permission: 'bash', pattern: 'git push *', action: 'deny' }] };
    answer({ 'debug agent build': ok(JSON.stringify(agent, null, 2)) });

    const rules = await readOpenCodeRules('opencode')({ cwd: '/work/app', agent: 'build' });

    expect(rules).toEqual([
      { permission: '*', pattern: '*', action: 'allow' },
      { permission: 'bash', pattern: 'git push *', action: 'deny' },
    ]);
    expect(calls[0]).toMatchObject({ args: ['debug', 'agent', 'build'], cwd: '/work/app' });
  });

  it('cannot say when OpenCode fails or prints something else', async () => {
    answer({ 'debug agent build': { code: 1, stdout: '', stderr: 'Error: Configuration is invalid' }, 'debug agent plan': ok('not json') });

    expect(await readOpenCodeRules('opencode')({ cwd: '/w', agent: 'build' })).toBeUndefined();
    expect(await readOpenCodeRules('opencode')({ cwd: '/w', agent: 'plan' })).toBeUndefined();
  });
});

describe("the person's own OpenCode MCP servers", () => {
  it('are the switched-on servers of the config OpenCode resolves where the turn runs', async () => {
    const config = { mcp: { vault: { type: 'local', command: ['node', 'x.mjs'] }, off: { type: 'local', command: ['node', 'y.mjs'], enabled: false } } };
    answer({ 'debug config': ok(JSON.stringify(config, null, 2)) });

    const servers = await readOpenCodeMcpServers('opencode')({ cwd: '/work/app' });

    expect(servers).toEqual(['vault']);
    expect(calls[0]).toMatchObject({ args: ['debug', 'config'], cwd: '/work/app' });
  });

  it('cannot say when OpenCode fails or prints something else', async () => {
    answer({ 'debug config': { code: 1, stdout: '', stderr: 'Error: Configuration is invalid' } });
    expect(await readOpenCodeMcpServers('opencode')({ cwd: '/w' })).toBeUndefined();

    answer({ 'debug config': ok('not json') });
    expect(await readOpenCodeMcpServers('opencode')({ cwd: '/w' })).toBeUndefined();
  });
});
