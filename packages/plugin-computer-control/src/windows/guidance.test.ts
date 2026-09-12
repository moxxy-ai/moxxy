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
  expect(result.system).toContain('computer_action_status');
  expect(result.system).toContain('pending receipt');
  expect(result.system).toContain('"root":null,"filter":null');
  expect(result.system).toContain('unknown-observation');
  expect(result.system).toContain('Do not retype the whole text');
  expect(result.system).toContain('blockingWindowId');
  expect(result.system).toContain('target_blocked');
  expect(result.system).toContain('selected color');
  expect(withWindowsComputerGuidance(result)).toBe(result);
  const noTools:ProviderRequest={model:'configured-model',messages:[]};
  expect(withWindowsComputerGuidance(noTools)).toBe(noTools);
  expect(plugin.hooks?.onBeforeProviderCall).toBe(withWindowsComputerGuidance);
  expect(createComputerControlPlugin('darwin','arm64').hooks).toBeUndefined();
});
