/**
 * "Ask moxxy to do it" Add buttons on the MCP / Providers tabs:
 *   1. Each tab renders its CTA in the Section actions slot.
 *   2. Clicking it opens the shared AgentTaskModal with the right title.
 *   3. Without an active workspace the modal says so and the CTA is disabled
 *      (the same guard the skill generate flow has).
 */

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { McpTab } from './McpTab';
import { ProvidersTab } from './ProvidersTab';

function installFakeApi(): void {
  __setApiOverride({
    invoke: (() => Promise.resolve(undefined)) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
}

afterEach(() => {
  __setApiOverride(null);
});

describe('settings Add buttons (agent-task flows)', () => {
  it('McpTab: "Add server" opens the agent-task modal', () => {
    installFakeApi();
    render(<McpTab servers={[]} onToggle={() => Promise.resolve()} onRefresh={() => Promise.resolve()} />);
    fireEvent.click(screen.getByRole('button', { name: /add server/i }));
    expect(screen.getByText('Add MCP server')).toBeTruthy();
    expect(screen.getByText(/describe the server/i)).toBeTruthy();
    // No active workspace in this harness — the guard must surface.
    expect(screen.getByText(/no active workspace/i)).toBeTruthy();
  });

  it('ProvidersTab: "Add provider" opens the agent-task modal', () => {
    installFakeApi();
    render(
      <ProvidersTab
        providers={[]}
        onToggle={() => Promise.resolve()}
        onConfigure={() => Promise.resolve()}
        onSetKey={() => Promise.resolve()}
        onRefresh={() => Promise.resolve()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add provider/i }));
    expect(screen.getByText('Add provider', { selector: 'h2, h3, header *' })).toBeTruthy();
    expect(screen.getByText(/describe the provider/i)).toBeTruthy();
  });
});
