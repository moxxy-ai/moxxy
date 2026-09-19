import { expect, it } from 'vitest';
import { createComputerControlPlugin } from '../index.js';

it('exposes explicit observed-window typing on Windows without weakening control-targeted typing', () => {
  const tools=createComputerControlPlugin('win32','x64').tools ?? [];
  const window=tools.find(tool=>tool.name==='computer_type_window');
  expect(window).toBeDefined();
  expect(window?.permission?.action).toBe('prompt');
  expect(window?.inputSchema.safeParse({windowId:'w',observationId:'o',text:'hello'}).success).toBe(true);
  expect(window?.inputSchema.safeParse({windowId:'w',text:'hello'}).success).toBe(false);
  const control=tools.find(tool=>tool.name==='computer_type');
  expect(control?.inputSchema.safeParse({windowId:'w',observationId:'o',text:'hello'}).success).toBe(false);
  expect(createComputerControlPlugin('darwin','arm64').tools?.some(tool=>tool.name==='computer_type_window')).toBe(false);
});
