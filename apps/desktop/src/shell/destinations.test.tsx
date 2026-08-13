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
  it('renders the catalog as one collapsible group, open by default', () => {
    render(<ChannelsIndex selected={null} onSelect={vi.fn()} />);
    const group = screen.getByTestId('channels-group');
    expect(group).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(group);
    expect(screen.getByTestId('channels-group')).toHaveAttribute('aria-expanded', 'false');
  });

  it('says the catalog is empty rather than rendering nothing', async () => {
    // Only AFTER the fetch settles: while it is in flight the column is loading,
    // not empty, and claiming "none available" then would be a lie with a race.
    render(<ChannelsIndex selected={null} onSelect={vi.fn()} />);
    expect(await screen.findByText('none available')).toBeTruthy();
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

  it('splits extensions from application settings in the product navigation', () => {
    const { rerender } = render(
      <SettingsIndex
        tab="providers"
        onPick={vi.fn()}
        scope="extensions"
      />,
    );
    expect(screen.getByText('agent')).toBeTruthy();
    expect(screen.getByText('extend')).toBeTruthy();
    expect(screen.queryByTestId('settings-tab-vault')).toBeNull();

    rerender(
      <SettingsIndex tab="vault" onPick={vi.fn()} scope="settings" />,
    );
    expect(screen.getByText('trust')).toBeTruthy();
    expect(screen.getByText('app')).toBeTruthy();
    expect(screen.queryByTestId('settings-tab-skills')).toBeNull();
  });

  it('picks a section on click', () => {
    const onPick = vi.fn();
    render(<SettingsIndex tab="providers" onPick={onPick} />);
    fireEvent.click(screen.getByTestId('settings-tab-vault'));
    expect(onPick).toHaveBeenCalledWith('vault');
  });
});
