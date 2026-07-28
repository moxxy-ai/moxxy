import { describe, it, expect } from 'vitest';
import { TOOL_ICONS, isToolIcon } from './tool-icon.js';
import { defineTool } from './define.js';
import { z } from 'zod';

describe('tool icons', () => {
  it('is a closed vocabulary, so a surface can map it exhaustively', () => {
    expect(isToolIcon('terminal')).toBe(true);
    // The whole reason the field is not a free string: a name no surface owns
    // would render as nothing anywhere.
    expect(isToolIcon('sparkles-v2')).toBe(false);
    expect(isToolIcon('')).toBe(false);
    expect(isToolIcon(undefined)).toBe(false);
  });

  it('has no duplicates, which would make a surface map ambiguous', () => {
    expect(new Set(TOOL_ICONS).size).toBe(TOOL_ICONS.length);
  });

  it('always offers a neutral choice for a tool that fits nothing else', () => {
    expect(TOOL_ICONS).toContain('wrench');
  });

  it('carries a declared icon through defineTool onto the def', () => {
    const tool = defineTool({
      name: 'thing',
      description: 'does a thing',
      icon: 'workflow',
      inputSchema: z.object({}),
      handler: () => undefined,
    });

    expect(tool.icon).toBe('workflow');
  });

  it('leaves icon undefined when a tool does not declare one', () => {
    const tool = defineTool({
      name: 'thing',
      description: 'does a thing',
      inputSchema: z.object({}),
      handler: () => undefined,
    });

    expect(tool.icon).toBeUndefined();
  });
});
