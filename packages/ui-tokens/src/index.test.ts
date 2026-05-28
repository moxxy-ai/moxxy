import { describe, expect, it } from 'vitest';
import {
  darkTokens,
  lightTokens,
  tokensFor,
  deskSwatches,
  type ThemeTokens,
} from './index.js';

describe('ui-tokens', () => {
  it('exposes structurally identical dark and light tokens', () => {
    expect(Object.keys(darkTokens).sort()).toEqual(Object.keys(lightTokens).sort());
  });

  it('every token is a 6-digit hex color', () => {
    const isHex = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v);
    for (const [name, token] of Object.entries(darkTokens) as Array<[string, string]>) {
      expect(isHex(token), `darkTokens.${name} = ${token}`).toBe(true);
    }
    for (const [name, token] of Object.entries(lightTokens) as Array<[string, string]>) {
      expect(isHex(token), `lightTokens.${name} = ${token}`).toBe(true);
    }
  });

  it('tokens objects are frozen so callers cannot mutate them', () => {
    expect(Object.isFrozen(darkTokens)).toBe(true);
    expect(Object.isFrozen(lightTokens)).toBe(true);
    expect(Object.isFrozen(deskSwatches)).toBe(true);
  });

  it('tokensFor returns the requested theme', () => {
    expect(tokensFor('dark')).toBe(darkTokens);
    expect(tokensFor('light')).toBe(lightTokens);
  });

  it('dark theme has darker background than light theme', () => {
    const brightness = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
    };
    expect(brightness(darkTokens.bg)).toBeLessThan(brightness(lightTokens.bg));
  });

  it('desk swatches are non-empty and unique', () => {
    expect(deskSwatches.length).toBeGreaterThan(0);
    expect(new Set(deskSwatches).size).toBe(deskSwatches.length);
  });

  it('the ThemeTokens type contract is complete', () => {
    const required: Array<keyof ThemeTokens> = [
      'bg', 'bgSecondary', 'bgCard', 'bgCardHover', 'border', 'borderLight',
      'text', 'textMuted', 'textDim', 'primary', 'primaryStrong', 'accent',
      'accentStrong', 'purple', 'green', 'orange', 'pink',
    ];
    for (const key of required) {
      expect(darkTokens[key]).toBeDefined();
      expect(lightTokens[key]).toBeDefined();
    }
  });
});
