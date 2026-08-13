import { beforeEach, describe, expect, it, vi } from 'vitest';

const spinnerInstance = {
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock('@clack/prompts', () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  isCancel: () => false,
  log: { error: vi.fn(), step: vi.fn(), success: vi.fn() },
  multiselect: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  spinner: () => spinnerInstance,
}));

import { confirm, multiselect, password, select } from '@clack/prompts';
import { runSetupWizard, type SetupWizardController } from './run-setup-wizard.js';

function controller(): SetupWizardController & {
  saveApiKey: ReturnType<typeof vi.fn>;
  writeConfig: ReturnType<typeof vi.fn>;
  installPlugins: ReturnType<typeof vi.fn>;
} {
  return {
    saveApiKey: vi.fn(async () => undefined),
    writeConfig: vi.fn(async () => '/tmp/config.yaml'),
    installPlugins: vi.fn(async () => undefined),
  };
}

const BASE = {
  providers: [{ id: 'anthropic', label: 'Anthropic' }],
  models: {
    anthropic: [
      { id: 'recommended-model', label: 'Recommended' },
      { id: 'other-model', label: 'Other' },
    ],
  },
  modes: [
    { id: 'default', label: 'Default' },
    { id: 'goal', label: 'Goal' },
  ],
  embedders: [
    { id: 'tfidf', label: 'Local' },
    { id: 'none', label: 'None' },
  ],
  availablePlugins: [{ id: 'browser', label: 'Browser' }],
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(password).mockResolvedValue('secret-key' as never);
});

describe('runSetupWizard progressive disclosure', () => {
  it('keeps personal setup to model connection and authentication', async () => {
    vi.mocked(select).mockResolvedValue('anthropic' as never);
    const ctl = controller();

    await runSetupWizard({ ...BASE, controller: ctl });

    expect(select).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(multiselect).not.toHaveBeenCalled();
    expect(ctl.installPlugins).not.toHaveBeenCalled();
    expect(ctl.saveApiKey).toHaveBeenCalledWith('anthropic', 'secret-key');
    expect(ctl.writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        primary: 'anthropic',
        model: 'recommended-model',
        mode: 'default',
        embedder: 'tfidf',
      }),
    );
  });

  it('preserves runtime and extension choices in advanced setup', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('anthropic' as never)
      .mockResolvedValueOnce('other-model' as never)
      .mockResolvedValueOnce('goal' as never)
      .mockResolvedValueOnce('none' as never);
    vi.mocked(confirm)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(true as never);
    const ctl = controller();

    await runSetupWizard({ ...BASE, controller: ctl, advanced: true });

    expect(select).toHaveBeenCalledTimes(4);
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(ctl.writeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'other-model',
        mode: 'goal',
        embedder: 'none',
      }),
    );
  });
});
