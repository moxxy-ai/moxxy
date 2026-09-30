import { zodToJsonSchema } from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';
import { batchActionNames, computerTools, resolveTarget } from './tools.js';

const input = <N extends keyof typeof computerTools>(name: N) => computerTools[name].input;

describe('computerTools', () => {
  it('exposes the Codex/Claude-style tool set', () => {
    expect(Object.keys(computerTools).sort()).toEqual([
      'computer_batch', 'computer_click', 'computer_drag', 'computer_get_app_state', 'computer_hold_key',
      'computer_list_apps', 'computer_mouse', 'computer_paste', 'computer_perform_secondary_action',
      'computer_press_key', 'computer_request_access', 'computer_screenshot', 'computer_scroll',
      'computer_select_text', 'computer_set_value', 'computer_type_text', 'computer_zoom',
    ]);
  });

  it('describes every tool and serialises every input as an object schema', () => {
    for (const [name, tool] of Object.entries(computerTools)) {
      expect(tool.description.length, name).toBeGreaterThan(40);
      const json = zodToJsonSchema(tool.input) as { type: string; properties: object };
      expect(json.type, name).toBe('object');
      expect(json.properties, name).toBeTypeOf('object');
    }
  });
});

describe('computer_click', () => {
  it('targets an element index or an image point, with defaults', () => {
    expect(input('computer_click').parse({ app: 'TextEdit', element_index: 3 }))
      .toEqual({ app: 'TextEdit', element_index: 3, mouse_button: 'left', click_count: 1 });
    expect(input('computer_click').parse({ app: 'TextEdit', x: 10.5, y: 20, mouse_button: 'right', click_count: 2 }))
      .toMatchObject({ x: 10.5, y: 20, mouse_button: 'right', click_count: 2 });
  });

  it.each([
    [{ app: 'TextEdit', element_index: 3, x: 1, y: 2 }, /exactly one target/],
    [{ app: 'TextEdit' }, /exactly one target/],
    [{ app: 'TextEdit', x: 1 }, /x and y/],
    [{ app: 'TextEdit', element_index: 1, click_count: 4 }, /click_count/],
    [{ app: 'TextEdit', element_index: -1 }, /element_index/],
    [{ app: 'TextEdit', element_index: 1, windowId: 'w' }, /Unrecognized/],
    [{ app: '', element_index: 1 }, /app/],
  ])('rejects %j', (value, message) => {
    expect(() => input('computer_click').parse(value)).toThrow(message);
  });

  it('accepts modifiers written like a key combo and rejects a real key there', () => {
    expect(input('computer_click').parse({ app: 'Finder', element_index: 1, modifiers: 'cmd+shift' }).modifiers).toBe('cmd+shift');
    expect(() => input('computer_click').parse({ app: 'Finder', element_index: 1, modifiers: 'cmd+a' })).toThrow(/modifiers only/);
  });
});

describe('resolveTarget', () => {
  it('names the target kind', () => {
    expect(resolveTarget({ element_index: 2 })).toEqual({ kind: 'element', index: 2 });
    expect(resolveTarget({ x: 4, y: 5 })).toEqual({ kind: 'point', x: 4, y: 5 });
    expect(resolveTarget({})).toEqual({ kind: 'focused' });
  });
});

describe('keyboard tools', () => {
  it('validates the key with the xdotool parser', () => {
    expect(input('computer_press_key').parse({ app: 'Safari', key: 'super+l' })).toEqual({ app: 'Safari', key: 'super+l', repeat: 1 });
    expect(() => input('computer_press_key').parse({ app: 'Safari', key: 'Enterr' })).toThrow(/unknown key/);
    expect(() => input('computer_press_key').parse({ app: 'Safari', key: 'a', repeat: 101 })).toThrow(/repeat/);
  });

  it('types into the focus or an element', () => {
    expect(input('computer_type_text').parse({ app: 'Notes', text: 'hi' })).toEqual({ app: 'Notes', text: 'hi' });
    expect(input('computer_type_text').parse({ app: 'Notes', text: 'hi', element_index: 5 }).element_index).toBe(5);
    expect(() => input('computer_type_text').parse({ app: 'Notes', text: '' })).toThrow();
  });

  it('pastes text, markdown or html', () => {
    expect(input('computer_paste').parse({ app: 'Pages', text: '<b>x</b>', format: 'html' }).format).toBe('html');
    expect(input('computer_paste').parse({ app: 'Pages', text: 'x' }).format).toBe('text');
    expect(() => input('computer_paste').parse({ app: 'Pages', text: 'x', format: 'rtf' })).toThrow();
  });

  it('holds a key or a modifier for up to 100 seconds', () => {
    expect(input('computer_hold_key').parse({ app: 'Resolve', key: 'shift', duration_s: 1.5 }).duration_s).toBe(1.5);
    expect(() => input('computer_hold_key').parse({ app: 'Resolve', key: 'space', duration_s: 0 })).toThrow(/duration_s/);
    expect(() => input('computer_hold_key').parse({ app: 'Resolve', key: 'space', duration_s: 101 })).toThrow(/duration_s/);
  });
});

describe('pointer tools', () => {
  it('scrolls an element or a point by pages', () => {
    expect(input('computer_scroll').parse({ app: 'Mail', element_index: 2, direction: 'down' }))
      .toEqual({ app: 'Mail', element_index: 2, direction: 'down', pages: 1 });
    expect(() => input('computer_scroll').parse({ app: 'Mail', direction: 'down' })).toThrow(/exactly one target/);
    expect(() => input('computer_scroll').parse({ app: 'Mail', x: 1, y: 1, direction: 'sideways' })).toThrow();
  });

  it('drags along a path with timing and modifiers', () => {
    const drag = input('computer_drag').parse({ app: 'Resolve', path: [[10, 10], [200, 10]], duration_ms: 800, modifiers: 'shift' });
    expect(drag).toEqual({ app: 'Resolve', path: [[10, 10], [200, 10]], duration_ms: 800, modifiers: 'shift', mouse_button: 'left' });
    expect(() => input('computer_drag').parse({ app: 'Resolve', path: [[10, 10]] })).toThrow(/path/);
    expect(() => input('computer_drag').parse({ app: 'Resolve', path: Array.from({ length: 21 }, () => [1, 1]) })).toThrow(/path/);
    expect(() => input('computer_drag').parse({ app: 'Resolve', path: [[1, 1, 1], [2, 2]] })).toThrow();
  });

  it('presses, moves and releases the mouse separately', () => {
    expect(input('computer_mouse').parse({ app: 'Resolve', event: 'down', x: 5, y: 6 }))
      .toEqual({ app: 'Resolve', event: 'down', x: 5, y: 6, mouse_button: 'left' });
    expect(() => input('computer_mouse').parse({ app: 'Resolve', event: 'hover', x: 5, y: 6 })).toThrow();
    expect(() => input('computer_mouse').parse({ app: 'Resolve', event: 'move' })).toThrow();
  });
});

describe('element tools', () => {
  it('sets values, selects text and performs exposed actions', () => {
    expect(input('computer_set_value').parse({ app: 'Safari', element_index: 1, value: 'openai.com' }).value).toBe('openai.com');
    expect(input('computer_select_text').parse({ app: 'Notes', element_index: 1, text: 'hello' }).selection_type).toBe('text');
    expect(() => input('computer_select_text').parse({ app: 'Notes', element_index: 1, text: 'x', selection_type: 'word' })).toThrow();
    expect(input('computer_perform_secondary_action').parse({ app: 'Finder', element_index: 4, secondary_action: 'AXShowMenu' }).secondary_action).toBe('AXShowMenu');
  });
});

describe('observation and access tools', () => {
  it('reads app state as a diff with a screenshot by default', () => {
    expect(input('computer_get_app_state').parse({ app: 'com.apple.TextEdit' }))
      .toEqual({ app: 'com.apple.TextEdit', disable_diff: false, include_screenshot: true });
  });

  it('lists apps with a bounded page', () => {
    expect(input('computer_list_apps').parse({})).toEqual({ limit: 50 });
    expect(() => input('computer_list_apps').parse({ limit: 500 })).toThrow(/limit/);
  });

  it('asks for a set of apps with a reason and optional grants', () => {
    expect(input('computer_request_access').parse({ apps: ['Notes'], reason: 'Write the list', clipboard_write: true }))
      .toEqual({ apps: ['Notes'], reason: 'Write the list', clipboard_write: true });
    expect(() => input('computer_request_access').parse({ apps: [], reason: 'x' })).toThrow(/apps/);
    expect(() => input('computer_request_access').parse({ apps: ['Notes'] })).toThrow(/reason/);
  });

  it('zooms into a positive region and scales screenshots within [0.1, 1]', () => {
    expect(input('computer_zoom').parse({ region: [0, 0, 100, 50] })).toEqual({ region: [0, 0, 100, 50] });
    expect(() => input('computer_zoom').parse({ region: [10, 10, 5, 50] })).toThrow(/region/);
    expect(() => input('computer_zoom').parse({ region: [0, 0, 1] })).toThrow();
    expect(input('computer_screenshot').parse({ scale: 0.5 })).toEqual({ scale: 0.5 });
    expect(() => input('computer_screenshot').parse({ scale: 2 })).toThrow(/scale/);
  });
});

describe('computer_batch', () => {
  it('parses a sequence of actions on one app into typed steps', () => {
    const batch = input('computer_batch').parse({
      app: 'Notes',
      actions: [
        { action: 'click', element_index: 1 },
        { action: 'type_text', text: 'hi' },
        { action: 'press_key', key: 'Return' },
        { action: 'wait', duration_s: 0.5 },
      ],
    });
    expect(batch.actions).toEqual([
      { action: 'click', element_index: 1, mouse_button: 'left', click_count: 1 },
      { action: 'type_text', text: 'hi' },
      { action: 'press_key', key: 'Return', repeat: 1 },
      { action: 'wait', duration_s: 0.5 },
    ]);
  });

  it('points at the invalid step', () => {
    const result = input('computer_batch').safeParse({ app: 'Notes', actions: [{ action: 'type_text', text: 'x' }, { action: 'click' }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ['actions', 1], message: expect.stringMatching(/exactly one target/) })]);
  });

  it('refuses nesting, other apps and oversized batches', () => {
    expect(batchActionNames).not.toContain('batch');
    expect(() => input('computer_batch').parse({ app: 'Notes', actions: [{ action: 'batch' }] })).toThrow();
    expect(() => input('computer_batch').parse({ app: 'Notes', actions: [{ action: 'click', element_index: 1, app: 'Mail' }] })).toThrow(/Unrecognized/);
    expect(() => input('computer_batch').parse({ app: 'Notes', actions: [] })).toThrow(/actions/);
    const many = Array.from({ length: 51 }, () => ({ action: 'press_key', key: 'Tab' }));
    expect(() => input('computer_batch').parse({ app: 'Notes', actions: many })).toThrow(/actions/);
  });
});
