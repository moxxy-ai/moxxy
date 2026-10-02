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
});
