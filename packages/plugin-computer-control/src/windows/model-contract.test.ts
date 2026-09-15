import { expect, it } from 'vitest';
import { createComputerControlPlugin } from '../index.js';

function tool(name: string) {
  const result = createComputerControlPlugin('win32', 'x64').tools?.find(item => item.name === name);
  if (!result) throw new Error('Missing tool: ' + name);
  return result;
}

it('ships its own complete schema even when a provider has an older SDK converter', () => {
  expect(tool('computer_open').inputJsonSchema).toMatchObject({ properties: {
    timeoutMs: { type: 'integer', minimum: 500, maximum: 8000 },
  } });
  const schema = tool('computer_observe').inputJsonSchema;
  expect(schema).toMatchObject({ required: ['windowId'], properties: {
    root: { anyOf: [expect.objectContaining({ type: 'object' }), { type: 'null' }] },
    filter: { anyOf: [expect.objectContaining({ type: 'object' }), { type: 'null' }] },
  } });
});

it('starts observation with omitted or explicit null options, never invented references', () => {
  const schema = tool('computer_observe').inputSchema;
  for (const options of [{}, { root: null, filter: null }, { root: null, filter: { nameIncludes: null, controlType: null } }]) {
    const parsed = schema.parse({ windowId: 'real-window-id', ...options });
    const wire = JSON.parse(JSON.stringify(parsed));
    expect(wire).not.toHaveProperty('root');
    expect(wire.filter ?? {}).toEqual({});
  }
  expect(schema.safeParse({ windowId: 'w', root: { observationId: '', elementId: '' } }).success).toBe(false);
  expect(schema.safeParse({ windowId: 'w', filter: { controlType: 0 } }).success).toBe(false);
});

it('allows a whole-window screenshot without a fabricated zero-sized crop', () => {
  const schema = tool('computer_screenshot').inputSchema;
  expect(JSON.parse(JSON.stringify(schema.parse({ windowId: 'w', region: null })))).not.toHaveProperty('region');
  expect(schema.safeParse({ windowId: 'w', region: { x: 0, y: 0, width: 0, height: 0 } }).success).toBe(false);
});
