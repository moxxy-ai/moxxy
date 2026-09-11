import { expect, it } from 'vitest';
import type { ProviderRequest } from '@moxxy/sdk';
import { createComputerControlPlugin } from '../index.js';
import { withWindowsComputerGuidance } from './guidance.js';

it('injects Windows guidance only with available computer tools and without changing model or messages', () => {
  const plugin=createComputerControlPlugin('win32','x64');
  const request:ProviderRequest={model:'configured-model',messages:[],system:'Existing instructions',tools:plugin.tools};
  const result=withWindowsComputerGuidance(request);
  expect(result.model).toBe(request.model);
  expect(result.messages).toBe(request.messages);
  expect(result.system).toContain('Existing instructions');
  expect(result.system).toContain('Windows x64');
  expect(result.system).toContain('needs_observation');
  expect(result.system).toContain('Do not bypass Stop');
  expect(withWindowsComputerGuidance(result)).toBe(result);
  const noTools:ProviderRequest={model:'configured-model',messages:[]};
  expect(withWindowsComputerGuidance(noTools)).toBe(noTools);
  expect(plugin.hooks?.onBeforeProviderCall).toBe(withWindowsComputerGuidance);
  expect(createComputerControlPlugin('darwin','arm64').hooks).toBeUndefined();
});
