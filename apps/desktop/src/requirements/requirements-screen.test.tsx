import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementsScreen } from './requirements-screen';
import { mockTauri } from '@/__mocks__/tauri';
import type {
  InstallHint,
  RequirementsApi,
  RequirementsStatus,
} from '@/lib/requirements';

// The screen's fallback `useRequirements()` runs even when api is
// passed (rules of hooks). Mock the tauri layer so that fallback
// doesn't try to call into the real runtime.
vi.mock('@/lib/tauri', () => import('@/__mocks__/tauri'));

beforeEach(() => {
  mockTauri.reset();
  mockTauri.respond('requirements_check', () => ({
    all_met: true,
    checks: [],
  }));
});

function fakeApi(
  status: RequirementsStatus | null,
  overrides: Partial<RequirementsApi> = {},
): RequirementsApi & {
  _ranInstall: InstallHint | null;
} {
  let ranInstall: InstallHint | null = null;
  const api: RequirementsApi & { _ranInstall: InstallHint | null } = {
    _ranInstall: null,
    status,
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    install: {
      running: false,
      progress: [],
      lastExitCode: null,
      error: null,
      run: vi.fn().mockImplementation(async (hint: InstallHint) => {
        ranInstall = hint;
        api._ranInstall = hint;
        return 0;
      }),
      reset: vi.fn(),
    },
    ...overrides,
  };
  return api;
}

describe('<RequirementsScreen />', () => {
  it('renders a loading state when probing for the first time', () => {
    const api = fakeApi(null, { loading: true });
    render(<RequirementsScreen api={api} />);
    expect(screen.getByText(/Probing/)).toBeInTheDocument();
  });

  it('lists each check with a satisfied or unmet indicator', () => {
    const api = fakeApi({
      allMet: false,
      checks: [
        { kind: 'node', satisfied: true, detail: 'v22.15.0' },
        {
          kind: 'moxxy-cli',
          satisfied: false,
          detail: 'not on PATH',
          install: {
            kind: 'command',
            program: 'npm',
            args: ['install', '-g', '@moxxy/cli'],
            label: 'Install moxxy CLI',
          },
        },
      ],
    });
    render(<RequirementsScreen api={api} />);
    expect(screen.getByTestId('requirement-node')).toHaveAttribute(
      'data-satisfied',
      'true',
    );
    expect(screen.getByTestId('requirement-moxxy-cli')).toHaveAttribute(
      'data-satisfied',
      'false',
    );
    expect(screen.getByTestId('requirement-install-moxxy-cli')).toHaveTextContent(
      'Install moxxy CLI',
    );
  });

  it('clicking Install forwards the hint to the api', async () => {
    const api = fakeApi({
      allMet: false,
      checks: [
        {
          kind: 'moxxy-cli',
          satisfied: false,
          install: {
            kind: 'command',
            program: 'npm',
            args: ['install', '-g', '@moxxy/cli'],
            label: 'Install moxxy CLI',
          },
        },
      ],
    });
    render(<RequirementsScreen api={api} />);
    await userEvent.click(screen.getByTestId('requirement-install-moxxy-cli'));
    expect(api._ranInstall).toMatchObject({
      kind: 'command',
      program: 'npm',
    });
  });

  it('hides the install button for satisfied requirements', () => {
    const api = fakeApi({
      allMet: true,
      checks: [{ kind: 'node', satisfied: true, detail: 'v22' }],
    });
    render(<RequirementsScreen api={api} />);
    expect(screen.queryByTestId('requirement-install-node')).toBeNull();
  });

  it('shows the install log while a command runs', () => {
    const api = fakeApi(
      {
        allMet: false,
        checks: [],
      },
      {
        install: {
          running: true,
          progress: [
            { line: '$ npm install -g @moxxy/cli', at: 1 },
            { line: 'added 42 packages', at: 2 },
          ],
          lastExitCode: null,
          error: null,
          run: vi.fn(),
          reset: vi.fn(),
        },
      },
    );
    render(<RequirementsScreen api={api} />);
    const log = screen.getByTestId('install-log');
    expect(log).toHaveTextContent('npm install -g @moxxy/cli');
    expect(log).toHaveTextContent('added 42 packages');
  });

  it('renders exit code coloured by success', () => {
    const api = fakeApi(
      { allMet: false, checks: [] },
      {
        install: {
          running: false,
          progress: [{ line: 'done', at: 1 }],
          lastExitCode: 0,
          error: null,
          run: vi.fn(),
          reset: vi.fn(),
        },
      },
    );
    render(<RequirementsScreen api={api} />);
    expect(screen.getByTestId('install-exit-code')).toHaveTextContent('exit 0');
  });

  it('Re-check triggers refresh', async () => {
    const api = fakeApi({ allMet: false, checks: [] });
    render(<RequirementsScreen api={api} />);
    await userEvent.click(screen.getByTestId('requirements-refresh'));
    expect(api.refresh).toHaveBeenCalled();
  });

  it('surfaces error state', () => {
    const api = fakeApi(null, { error: 'probe failed' });
    render(<RequirementsScreen api={api} />);
    expect(screen.getByRole('alert')).toHaveTextContent('probe failed');
  });

  it('fires onReady when status flips to allMet', () => {
    const onReady = vi.fn();
    const api = fakeApi({ allMet: true, checks: [] });
    render(<RequirementsScreen api={api} onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('only fires onReady once even on re-renders', () => {
    const onReady = vi.fn();
    const api = fakeApi({ allMet: true, checks: [] });
    const { rerender } = render(
      <RequirementsScreen api={api} onReady={onReady} />,
    );
    rerender(<RequirementsScreen api={api} onReady={onReady} />);
    rerender(<RequirementsScreen api={api} onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
