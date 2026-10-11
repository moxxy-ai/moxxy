import type { ProviderRequest } from '@moxxy/sdk';
import { expect, it } from 'vitest';
import { withComputerGuidance } from './guidance.js';

const tool = (name: string) => ({ name, description: '', inputSchema: {} }) as never;

it('adds the working rules once, only when the request carries Computer Use tools', () => {
  const request: ProviderRequest = { model: 'configured-model', messages: [], system: 'Existing instructions', tools: [tool('computer_get_app_state')] };
  const guided = withComputerGuidance('darwin')(request);
  expect(guided.model).toBe(request.model);
  expect(guided.messages).toBe(request.messages);
  expect(guided.system).toContain('Existing instructions');
  expect(guided.system).toContain('computer_request_access');
  expect(guided.system).toContain('element_index');
  expect(guided.system).toMatch(/untrusted/);
  expect(guided.system).toMatch(/delivered.*not.*done/i);
  expect(guided.system).toMatch(/super.*Command/);
  expect(withComputerGuidance('darwin')(guided)).toBe(guided);
  const plain: ProviderRequest = { model: 'configured-model', messages: [], tools: [tool('Read')] };
  expect(withComputerGuidance('darwin')(plain)).toBe(plain);
});

it('names the Windows key on Windows', () => {
  const guided = withComputerGuidance('win32')({ model: 'm', messages: [], tools: [tool('computer_click')] });
  expect(guided.system).toMatch(/super.*Windows key/);
});

it('tells the model how to finish in few rounds', () => {
  const { system } = withComputerGuidance('darwin')({ model: 'm', messages: [], tools: [tool('computer_click')] });
  expect(system).toMatch(/several tool calls in one response/);
  expect(system).toMatch(/run in the order/);
  expect(system).toMatch(/result already (has|contains) the fresh state/);
  expect(system).toMatch(/keyboard/);
  expect(system).not.toMatch(/One action per call/);
});

it('names the Super key for Linux', () => {
  const { system } = withComputerGuidance('linux')({ model: 'm', messages: [], tools: [tool('computer_click')] });
  expect(system).toContain('"super" is the Super (Windows) key');
});

it('sends known steps through computer_run and keeps trying other routes', () => {
  const { system } = withComputerGuidance('darwin')({ model: 'm', messages: [], tools: [tool('computer_click')] });
  expect(system).toMatch(/computer_run/);
  expect(system).toMatch(/expect/);
  expect(system).toMatch(/Do not give up/);
  expect(system).toMatch(/several different routes/);
  expect(system).toMatch(/even a single step/);
  expect(system).toMatch(/remembers what worked/);
  // Every look is a model round of seconds: computer_run looks itself.
  expect(system).toMatch(/computer_run looks at the window itself/);
  // Asking for the app first is a round too: approving the run is the consent to its app.
  expect(system).toMatch(/start with computer_run[^.]*without computer_request_access/);
  expect(system).toMatch(/computer_request_access only for[^.]*app_not_allowed/);
  expect(system).not.toMatch(/Ask once with computer_request_access for every app/);
  expect(system).toMatch(/loaded already[^.]*without load_tool/);
  // A browser run that presses keys or types is refused at the default level: asked for first, both go in one response.
  expect(system).toMatch(/keys or text into a browser or terminal[^.]*full_access[^.]*before computer_run[^.]*one response/);
});

it('leaves computer_run out, tool and words, where it cannot run', () => {
  const request: ProviderRequest = { model: 'm', messages: [], tools: [tool('computer_run'), tool('computer_click')] };
  const off = withComputerGuidance('darwin', () => false)(request, { sessionId: 's' });
  expect(off.system).toMatch(/Ask once with computer_request_access for every app/);
  expect(off.tools?.map((entry) => entry.name)).toEqual(['computer_click']);
  expect(off.system).not.toMatch(/computer_run/);
  expect(off.system).toMatch(/several tool calls in one response/);
  expect(off.system).toMatch(/Do not give up/);
  const again = withComputerGuidance('darwin', () => false)({ ...request, system: off.system }, { sessionId: 's' });
  expect(again.tools?.map((entry) => entry.name)).toEqual(['computer_click']);
  expect(again.system).toBe(off.system);
  const on = withComputerGuidance('darwin', (session) => session === 's')(request, { sessionId: 's' });
  expect(on.tools).toBe(request.tools);
  expect(on.system).toMatch(/computer_run/);
});

// On gpt-6-luna the turn ended at "has no open window" in 5 of 5 trials, though the state names the shortcut.
it('treats a Mac app without an open window as something to open, not a block', () => {
  const { system } = withComputerGuidance('darwin')({ model: 'm', messages: [], tools: [tool('computer_click')] });
  expect(system).toMatch(/runs without an open window is not a block: open a window with computer_press_key \(super\+n, or the shortcut the state names\) and carry on with the task\.$/);
  // Only the macOS helper sends keys to an app that has no window.
  for (const platform of ['win32', 'linux'] as const) {
    expect(withComputerGuidance(platform)({ model: 'm', messages: [], tools: [tool('computer_click')] }).system).not.toMatch(/without an open window/);
  }
});
