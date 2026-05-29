import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRequirements } from './requirements';
import { mockTauri } from '@/__mocks__/tauri';

vi.mock('@/lib/tauri', () => import('@/__mocks__/tauri'));

describe('useRequirements', () => {
  beforeEach(() => {
    mockTauri.reset();
  });

  it('starts loading and adopts the first probe', async () => {
    mockTauri.respond('requirements_check', () => ({
      all_met: true,
      checks: [{ kind: 'node', satisfied: true, detail: 'v22' }],
    }));
    const { result } = renderHook(() => useRequirements());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status?.allMet).toBe(true);
    expect(result.current.status?.checks).toHaveLength(1);
  });

  it('accepts both snake_case and camelCase from the Rust side', async () => {
    // The Tauri side currently emits snake_case via Serialize default.
    mockTauri.respond('requirements_check', () => ({
      all_met: false,
      checks: [
        { kind: 'node', satisfied: false, detail: 'missing' },
        { kind: 'moxxy-cli', satisfied: true },
      ],
    }));
    const { result } = renderHook(() => useRequirements());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.status?.allMet).toBe(false);
  });

  it('captures errors from requirements_check', async () => {
    mockTauri.respond('requirements_check', () => {
      throw new Error('probe failed');
    });
    const { result } = renderHook(() => useRequirements());
    await waitFor(() => expect(result.current.error).toBe('probe failed'));
  });

  it('run() invokes the install + refreshes', async () => {
    let installed = false;
    mockTauri.respond('requirements_check', () => ({
      all_met: installed,
      checks: [
        {
          kind: 'moxxy-cli',
          satisfied: installed,
          detail: installed ? 'installed' : 'missing',
          install: installed
            ? undefined
            : {
                kind: 'command',
                program: 'npm',
                args: ['install', '-g', '@moxxy/cli'],
                label: 'Install moxxy CLI',
              },
        },
      ],
    }));
    mockTauri.respond('requirements_install', () => {
      installed = true;
      return 0;
    });
    const { result } = renderHook(() => useRequirements());
    await waitFor(() => expect(result.current.status?.allMet).toBe(false));

    let code: number | null = null;
    await act(async () => {
      code = await result.current.install.run({
        kind: 'command',
        program: 'npm',
        args: ['install', '-g', '@moxxy/cli'],
        label: 'Install moxxy CLI',
      });
    });

    expect(code).toBe(0);
    await waitFor(() => expect(result.current.status?.allMet).toBe(true));
  });

  it('install error path captures the failure and stays not-running', async () => {
    mockTauri.respond('requirements_check', () => ({
      all_met: false,
      checks: [],
    }));
    mockTauri.respond('requirements_install', () => {
      throw new Error('spawn npm: ENOENT');
    });
    const { result } = renderHook(() => useRequirements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let code: number | null = 99;
    await act(async () => {
      code = await result.current.install.run({
        kind: 'open-url',
        url: 'https://moxxy.ai/',
        label: 'open',
      });
    });
    expect(code).toBeNull();
    expect(result.current.install.error).toContain('ENOENT');
    expect(result.current.install.running).toBe(false);
  });

  it('progress events accumulate in the install log', async () => {
    mockTauri.respond('requirements_check', () => ({
      all_met: false,
      checks: [],
    }));
    const { result } = renderHook(() => useRequirements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      mockTauri.emit('requirements.install.progress', 'line one');
      mockTauri.emit('requirements.install.progress', 'line two');
    });
    await waitFor(() => expect(result.current.install.progress).toHaveLength(2));
    expect(result.current.install.progress[0]?.line).toBe('line one');
  });

  it('reset() clears the install log', async () => {
    mockTauri.respond('requirements_check', () => ({
      all_met: false,
      checks: [],
    }));
    const { result } = renderHook(() => useRequirements());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => mockTauri.emit('requirements.install.progress', 'noise'));
    await waitFor(() => expect(result.current.install.progress.length).toBe(1));
    act(() => result.current.install.reset());
    expect(result.current.install.progress).toEqual([]);
  });
});
