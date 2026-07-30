import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { AutomationsIndex } from '../automations/AutomationsPanel';
import { ChannelsIndex } from '../channels/ChannelsSurface';
import { SettingsIndex } from '../settings/SettingsPanel';
import { reloadSidebarCollapsedFromStorage } from '@/lib/useSidebarCollapsed';

/**
 * Every destination gets an index column, and each one answers the same question
 * in the same shape: "what is in here". These pin the contract that made the
 * split-nav fix worth doing — one navigation organ (the rail), one contextual
 * list beside it, and no destination that navigates from somewhere else.
 */

beforeEach(() => {
  window.localStorage.clear();
  reloadSidebarCollapsedFromStorage();
  __setApiOverride({
    invoke: vi.fn(async () => ({})),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});
afterEach(() => __setApiOverride(null));

describe('AutomationsIndex', () => {
  it('lists the three kinds that fire themselves', () => {
    render(<AutomationsIndex kind="workflows" onPick={vi.fn()} />);
    for (const id of ['workflows', 'schedules', 'webhooks']) {
      expect(screen.getByTestId(`automations-kind-${id}`)).toBeTruthy();
    }
  });

  it('marks exactly the open kind, and picks another on click', () => {
    const onPick = vi.fn();
    render(<AutomationsIndex kind="schedules" onPick={onPick} />);
    expect(screen.getByTestId('automations-kind-schedules')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByTestId('automations-kind-workflows')).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByTestId('automations-kind-webhooks'));
    expect(onPick).toHaveBeenCalledWith('webhooks');
  });
});

describe('ChannelsIndex', () => {
  it('holds Mobile as one channel among the rest, not a destination of its own', () => {
    const onPick = vi.fn();
    render(<ChannelsIndex section="connected" onPick={onPick} />);
    expect(screen.getByTestId('channels-section-connected')).toBeTruthy();
    expect(screen.getByTestId('channels-section-mobile')).toBeTruthy();
    fireEvent.click(screen.getByTestId('channels-section-mobile'));
    expect(onPick).toHaveBeenCalledWith('mobile');
  });
});

describe('SettingsIndex', () => {
  it('groups the sections by what they are about', () => {
    render(<SettingsIndex tab="providers" onPick={vi.fn()} />);
    for (const group of ['agent', 'extend', 'trust', 'app']) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    // A flat row gave "Vault" and "Skills" the same standing, when one is a
    // secret store and the other a capability.
    expect(screen.getByTestId('settings-tab-vault')).toBeTruthy();
    expect(screen.getByTestId('settings-tab-skills')).toBeTruthy();
  });

  it('picks a section on click', () => {
    const onPick = vi.fn();
    render(<SettingsIndex tab="providers" onPick={onPick} />);
    fireEvent.click(screen.getByTestId('settings-tab-vault'));
    expect(onPick).toHaveBeenCalledWith('vault');
  });
});
