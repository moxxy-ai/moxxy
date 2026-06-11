/**
 * `?demo=1` — a scripted, backend-free tour of the office. Drives the
 * director with a believable sequence: three agents walk in and wander, one
 * gets a prompt and goes to think in its office (streaming bubbles, a tool
 * call), spawns two subagents that meet in the war room, hits a permission
 * ask, finishes, and a fourth agent gets hired late. Loops forever.
 */

import type { OfficeDirector } from '../sim/director.js';
import type { DirectorInput } from '../sim/types.js';

interface Step {
  readonly at: number; // ms since script start
  readonly input: DirectorInput;
}

const ROSTER3 = [
  { id: 'demo-alice', name: 'Alice' },
  { id: 'demo-bob', name: 'Bob' },
  { id: 'demo-carol', name: 'Carol' },
];

const SCRIPT: ReadonlyArray<Step> = [
  { at: 500, input: { kind: 'roster', sessions: ROSTER3, activeId: 'demo-alice' } },

  // Alice gets prompted: walks to office 0, types, streams, calls a tool.
  { at: 6000, input: { kind: 'turn-started', workspaceId: 'demo-alice' } },
  { at: 9500, input: { kind: 'assistant-delta', workspaceId: 'demo-alice', delta: 'Let me think about the quarterly numbers. ' } },
  { at: 10400, input: { kind: 'assistant-delta', workspaceId: 'demo-alice', delta: 'First I will check the spreadsheet. ' } },
  { at: 11500, input: { kind: 'tool-call', workspaceId: 'demo-alice', tool: 'read_file' } },
  { at: 13500, input: { kind: 'assistant-delta', workspaceId: 'demo-alice', delta: 'Revenue is up 14% — drafting the summary now. ' } },

  // She delegates: two subagents gather in the war room.
  { at: 15000, input: { kind: 'subagent-started', workspaceId: 'demo-alice', childId: 'demo-sub-1', label: 'researcher' } },
  { at: 16500, input: { kind: 'subagent-started', workspaceId: 'demo-alice', childId: 'demo-sub-2', label: 'fact-checker' } },
  { at: 19500, input: { kind: 'subagent-delta', childId: 'demo-sub-1', delta: 'Scanning the Q2 filings for comparables. ' } },
  { at: 21000, input: { kind: 'subagent-tool', childId: 'demo-sub-2', tool: 'web_fetch' } },
  { at: 23000, input: { kind: 'subagent-delta', childId: 'demo-sub-2', delta: 'Two sources confirm the 14% figure. ' } },
  { at: 25500, input: { kind: 'subagent-done', childId: 'demo-sub-1', text: 'Found 3 comparables.' } },
  { at: 27000, input: { kind: 'subagent-done', childId: 'demo-sub-2', text: 'Verified.' } },

  // A permission ask freezes her, then gets approved.
  { at: 28500, input: { kind: 'ask-opened', workspaceId: 'demo-alice' } },
  { at: 32500, input: { kind: 'ask-cleared', workspaceId: 'demo-alice' } },
  { at: 33500, input: { kind: 'assistant-final', workspaceId: 'demo-alice', text: 'Summary drafted and saved to reports/q2.md.' } },
  { at: 34500, input: { kind: 'turn-complete', workspaceId: 'demo-alice' } },

  // Meanwhile Bob does a quick turn at his desk.
  { at: 18000, input: { kind: 'turn-started', workspaceId: 'demo-bob' } },
  { at: 22000, input: { kind: 'assistant-delta', workspaceId: 'demo-bob', delta: 'Refactoring the parser as asked. ' } },
  { at: 26000, input: { kind: 'turn-complete', workspaceId: 'demo-bob' } },

  // A fourth agent is hired late and walks in.
  {
    at: 38000,
    input: {
      kind: 'roster',
      sessions: [...ROSTER3, { id: 'demo-dave', name: 'Dave' }],
      activeId: 'demo-alice',
    },
  },
  { at: 44000, input: { kind: 'turn-started', workspaceId: 'demo-dave' } },
  { at: 47000, input: { kind: 'assistant-delta', workspaceId: 'demo-dave', delta: 'Onboarding myself. Where is the coffee machine?' } },
  { at: 50000, input: { kind: 'turn-complete', workspaceId: 'demo-dave' } },
];

const LOOP_MS = 56_000;

export function startDemo(director: OfficeDirector): void {
  const run = () => {
    for (const step of SCRIPT) {
      window.setTimeout(() => director.input(step.input), step.at);
    }
  };
  run();
  window.setInterval(run, LOOP_MS);
}
