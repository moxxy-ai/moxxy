import { expect, it } from 'vitest';
import { readTextSchema, selectTextSchema, textResultSchema } from './contracts.js';

const target = { windowId: 'w', observationId: 'o', elementId: 'e' };
it('requires an observed text target and bounds text output and selection', () => {
  expect(readTextSchema.parse(target)).toEqual({ ...target, maxChars: 4000 });
  expect(readTextSchema.safeParse({ ...target, maxChars: 0 }).success).toBe(false);
  expect(selectTextSchema.parse({ ...target, text: 'gęślą' })).toEqual({ ...target, text: 'gęślą', occurrence: 1 });
  expect(selectTextSchema.safeParse({ ...target, text: '' }).success).toBe(false);
  expect(selectTextSchema.safeParse({ ...target, text: 'a', occurrence: 0 }).success).toBe(false);
  expect(selectTextSchema.safeParse({ windowId: 'w', text: 'a' }).success).toBe(false);
  expect(textResultSchema.safeParse({ text: 'Zażółć', selectedText: ['żółć'], truncated: false }).success).toBe(true);
  expect(textResultSchema.safeParse({ text: 'x'.repeat(16001), selectedText: [], truncated: false }).success).toBe(false);
});
