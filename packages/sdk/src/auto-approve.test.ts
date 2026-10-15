import { describe, expect, it } from 'vitest';
import { AUTO_APPROVE_PLUGIN_ID, AUTO_APPROVE_SUBTYPE, autoApproveFromAgent, autoApproveFromEvents, autoApproveRecorded, autoApproveSwitch } from './auto-approve.js';
import type { MoxxyEvent } from './events.js';

let seq = 0;
const base = () => ({ id: `e${seq}`, seq: seq++, ts: 0, sessionId: 's', turnId: 't' }) as const;
const switched = (enabled: unknown): MoxxyEvent =>
  ({ ...base(), type: 'plugin_event', source: 'user', pluginId: AUTO_APPROVE_PLUGIN_ID, subtype: AUTO_APPROVE_SUBTYPE, payload: { enabled } }) as unknown as MoxxyEvent;
const fromSystem = (enabled: boolean): MoxxyEvent => ({ ...switched(enabled), source: 'system' }) as MoxxyEvent;
const prompt = (): MoxxyEvent => ({ ...base(), type: 'user_prompt', source: 'user', text: 'hi' }) as unknown as MoxxyEvent;
const otherPlugin = (): MoxxyEvent =>
  ({ ...base(), type: 'plugin_event', source: 'plugin', pluginId: 'x', subtype: AUTO_APPROVE_SUBTYPE, payload: { enabled: true } }) as unknown as MoxxyEvent;

describe('auto-approve fold', () => {
  it('is off for a conversation that never switched it', () => {
    expect(autoApproveFromEvents([prompt(), prompt()])).toBe(false);
  });

  it('follows the last recorded switch', () => {
    expect(autoApproveFromEvents([switched(true), prompt()])).toBe(true);
    expect(autoApproveFromEvents([switched(true), prompt(), switched(false)])).toBe(false);
  });

  it('reads a switch only from the auto-approve record itself', () => {
    expect(autoApproveSwitch(switched(true))).toBe(true);
    expect(autoApproveSwitch(prompt())).toBeNull();
    expect(autoApproveSwitch(otherPlugin())).toBeNull();
    expect(autoApproveSwitch(switched('yes'))).toBeNull();
  });

  it('says whether the conversation recorded a switch at all, even one back to off', () => {
    expect(autoApproveRecorded([prompt(), otherPlugin()])).toBe(false);
    expect(autoApproveRecorded([switched(true), prompt(), switched(false)])).toBe(true);
  });

  it("says whether the switch in force is the agent's own setup Moxxy took on, not the person's choice", () => {
    expect(autoApproveFromAgent([prompt()])).toBe(false);
    expect(autoApproveFromAgent([fromSystem(true), prompt()])).toBe(true);
    expect(autoApproveFromAgent([fromSystem(true), switched(false), switched(true)])).toBe(false);
  });
});
