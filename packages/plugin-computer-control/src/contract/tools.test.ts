import { zodToJsonSchema } from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';
import { actionNames, computerTools, resolveTarget } from './tools.js';

const input = <N extends keyof typeof computerTools>(name: N): (typeof computerTools)[N]['input'] => computerTools[name].input;
const properties = (name: keyof typeof computerTools) => Object.keys((zodToJsonSchema(computerTools[name].input) as { properties: object }).properties).sort();

describe('computerTools', () => {
  // Nine tools as in Codex, plus the access request, the permission status and a closer look.
  it('exposes a small tool set a model can fill without guessing', () => {
    expect(Object.keys(computerTools).sort()).toEqual([
      'computer_click', 'computer_drag', 'computer_get_app_state', 'computer_list_apps', 'computer_perform_secondary_action',
      'computer_press_key', 'computer_request_access', 'computer_scroll', 'computer_set_value', 'computer_status',
      'computer_type_text', 'computer_zoom',
    ]);
    expect(actionNames).toEqual(['click', 'type_text', 'press_key', 'scroll', 'drag', 'set_value', 'perform_secondary_action']);
  });

  it('describes every tool and serialises every input as an object schema', () => {
    for (const [name, tool] of Object.entries(computerTools)) {
      expect(tool.description.length, name).toBeGreaterThan(40);
      const json = zodToJsonSchema(tool.input) as { type: string; properties: object };
      expect(json.type, name).toBe('object');
      expect(json.properties, name).toBeTypeOf('object');
    }
  });

  // A model fills every field it is shown, so each tool shows only what it needs.
  it('asks for no field a tool can do without', () => {
    expect(properties('computer_type_text')).toEqual(['app', 'element_index', 'text']);
    expect(properties('computer_press_key')).toEqual(['app', 'key', 'repeat']);
    expect(properties('computer_drag')).toEqual(['app', 'from_x', 'from_y', 'to_x', 'to_y']);
    expect(properties('computer_get_app_state')).toEqual(['app', 'disable_diff', 'window_id']);
    expect(properties('computer_zoom')).toEqual(['app', 'region']);
  });
});

describe('computer_click', () => {
  it('targets an element index or an image point, with defaults', () => {
    expect(input('computer_click').parse({ app: 'TextEdit', element_index: 3 }))
      .toEqual({ app: 'TextEdit', element_index: 3, mouse_button: 'left', click_count: 1 });
    expect(input('computer_click').parse({ app: 'TextEdit', x: 10.5, y: 20, mouse_button: 'right', click_count: 2 }))
      .toMatchObject({ x: 10.5, y: 20, mouse_button: 'right', click_count: 2 });
  });

  it('ignores the filler a model sends for fields it does not use', () => {
    expect(input('computer_click').parse({ app: 'TextEdit', element_index: 3, x: 0, y: 0, mouse_button: 'left', click_count: 1, modifiers: '' }))
      .toEqual({ app: 'TextEdit', element_index: 3, mouse_button: 'left', click_count: 1 });
    expect(input('computer_click').parse({ app: 'TextEdit', element_index: null, x: 10, y: 20, modifiers: null }))
      .toEqual({ app: 'TextEdit', x: 10, y: 20, mouse_button: 'left', click_count: 1 });
    expect(input('computer_click').parse({ app: 'TextEdit', x: 0, y: 0 })).toMatchObject({ x: 0, y: 0 });
    // A real point sent with an element is where the model looked: the point is the target.
    expect(input('computer_click').parse({ app: 'TextEdit', element_index: 11, x: 81, y: 316 })).toEqual({ app: 'TextEdit', x: 81, y: 316, mouse_button: 'left', click_count: 1 });
    expect(input('computer_click').parse({ app: 'Numbers', element_index: 0, x: 200, y: 188 })).toEqual({ app: 'Numbers', x: 200, y: 188, mouse_button: 'left', click_count: 1 });
    expect(input('computer_set_value').parse({ app: 'TextEdit', element_index: 1, value: '' })).toMatchObject({ value: '' });
    expect(input('computer_click').parse({ app: 'Numbers', element_index: 0, x: 0, y: 0 })).toMatchObject({ element_index: 0 });
  });

  it.each([
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

  // The window itself (index 0) takes no text, so a zero there is filler and the text goes to the focused element.
  it('takes an element index of zero as no target when typing', () => {
    expect(input('computer_type_text').parse({ app: 'Numbers', element_index: 0, text: '10' })).toEqual({ app: 'Numbers', text: '10' });
    expect(input('computer_type_text').parse({ app: 'Numbers', element_index: null, text: '10' })).toEqual({ app: 'Numbers', text: '10' });
    expect(() => input('computer_type_text').parse({ app: 'Numbers', x: 5, y: 5, text: '10' })).toThrow(/Unrecognized/);
  });
});

describe('pointer tools', () => {
  it('scrolls an element or a point by pages', () => {
    expect(input('computer_scroll').parse({ app: 'Mail', element_index: 2, direction: 'down' }))
      .toEqual({ app: 'Mail', element_index: 2, direction: 'down', pages: 1 });
    expect(() => input('computer_scroll').parse({ app: 'Mail', direction: 'down' })).toThrow(/exactly one target/);
    expect(() => input('computer_scroll').parse({ app: 'Mail', x: 1, y: 1, direction: 'sideways' })).toThrow();
  });

  it('drags from one screenshot point to another', () => {
    expect(input('computer_drag').parse({ app: 'CapCut', from_x: 558, from_y: 660, to_x: 340, to_y: 660 }))
      .toEqual({ app: 'CapCut', from_x: 558, from_y: 660, to_x: 340, to_y: 660 });
    expect(() => input('computer_drag').parse({ app: 'CapCut', from_x: 558, from_y: 660, to_x: 340 })).toThrow(/to_y/);
    expect(() => input('computer_drag').parse({ app: 'CapCut', from_x: -1, from_y: 660, to_x: 340, to_y: 660 })).toThrow(/from_x/);
    expect(() => input('computer_drag').parse({ app: 'CapCut', path: [[1, 1], [2, 2]] })).toThrow();
  });
});

describe('element tools', () => {
  it('sets values and performs exposed actions', () => {
    expect(input('computer_set_value').parse({ app: 'Safari', element_index: 1, value: 'openai.com' }).value).toBe('openai.com');
    expect(input('computer_perform_secondary_action').parse({ app: 'Finder', element_index: 4, secondary_action: 'AXShowMenu' }).secondary_action).toBe('AXShowMenu');
  });
});

describe('observation and access tools', () => {
  it('reads app state as a diff by default', () => {
    expect(input('computer_get_app_state').parse({ app: 'com.apple.TextEdit' })).toEqual({ app: 'com.apple.TextEdit', disable_diff: false });
    expect(input('computer_get_app_state').parse({ app: 'Notepad', window_id: '' })).toEqual({ app: 'Notepad', disable_diff: false });
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
    expect(input('computer_request_access').parse({ apps: ['Safari'], reason: 'Form', full_access: ['Safari'] }).full_access).toEqual(['Safari']);
    expect(() => input('computer_request_access').parse({ apps: ['Notes'], reason: 'x', full_access: ['Safari'] })).toThrow(/full_access/);
  });

  it('zooms into a positive region of an app screenshot', () => {
    expect(input('computer_zoom').parse({ app: 'CapCut', region: [0, 0, 100, 50] })).toEqual({ app: 'CapCut', region: [0, 0, 100, 50] });
    expect(() => input('computer_zoom').parse({ app: 'CapCut', region: [10, 10, 5, 50] })).toThrow(/region/);
    expect(() => input('computer_zoom').parse({ app: 'CapCut', region: [0, 0, 1] })).toThrow();
    expect(() => input('computer_zoom').parse({ region: [0, 0, 100, 50] })).toThrow(/app/);
  });
});
