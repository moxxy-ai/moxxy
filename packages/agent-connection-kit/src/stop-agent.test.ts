import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { stopAgentProcess } from './stop-agent.js';

function fakeChild(): ChildProcess & { kill: ReturnType<typeof vi.fn> } {
  return { pid: 4242, kill: vi.fn(() => true) } as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
}

describe('stopping a live agent process', () => {
  it('ends the whole tree on Windows, where an npm install runs the agent under a Node launcher', () => {
    const child = fakeChild();
    const killTree = vi.fn();

    stopAgentProcess(child, { platform: 'win32', killTree });

    expect(killTree).toHaveBeenCalledWith(child, 'SIGTERM');
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('signals the agent itself on macOS and Linux, where it has no process group of its own', () => {
    const child = fakeChild();
    const killTree = vi.fn();

    stopAgentProcess(child, { platform: 'darwin', killTree });
    stopAgentProcess(child, { platform: 'linux', killTree });

    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(killTree).not.toHaveBeenCalled();
  });
});
