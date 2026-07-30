import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { AutomationsIndex } from '../automations/AutomationsIndex';
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
  // Shape-correct payloads: a bare `{}` leaves each hook's `list` undefined once
  // its fetch settles, so the first render passes and every later one throws.
  __setApiOverride({
    invoke: vi.fn(async (channel: string) =>
      channel.endsWith('.list') ? [] : ({} as unknown),
    ),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});
afterEach(() => __setApiOverride(null));

describe('AutomationsIndex', () => {
  it('lists the three kinds as collapsible groups', () => {
    render(<AutomationsIndex kind="workflows" onPick={vi.fn()} />);
    for (const id of ['workflows', 'schedules', 'webhooks']) {
      const group = screen.getByTestId(`automations-group-${id}`);
      expect(group).toBeTruthy();
      // Open by default: a fresh column that hides everything behind three
      // chevrons answers no question at all.
      expect(group).toHaveAttribute('aria-expanded', 'true');
    }
  });

  it('folds a group and picks its kind', () => {
    const onPick = vi.fn();
    render(<AutomationsIndex kind="workflows" onPick={onPick} />);
    const group = screen.getByTestId('automations-group-webhooks');
    fireEvent.click(group);
    expect(onPick).toHaveBeenCalledWith('webhooks');
    expect(screen.getByTestId('automations-group-webhooks')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('says a group is empty rather than rendering nothing under it', () => {
    // An open group with no rows and no message reads as a rendering failure.
    render(<AutomationsIndex kind="workflows" onPick={vi.fn()} />);
    expect(screen.getAllByText('none yet').length).toBeGreaterThan(0);
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
