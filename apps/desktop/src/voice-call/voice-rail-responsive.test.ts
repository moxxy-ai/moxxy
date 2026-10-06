import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/voice-call/voice-rail.css'),
  'utf8',
);

describe('voice rail responsive contract', () => {
  it('uses the available rail width instead of the viewport width', () => {
    expect(stylesheet).toMatch(
      /\.voice-rail-shell\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*voice-rail;/s,
    );
    expect(stylesheet).toContain('@container voice-rail');
    expect(stylesheet).not.toMatch(/@media\s*\(max-width:/);
  });

  it('keeps the primary voice state and gives up the idle work placeholder first', () => {
    expect(stylesheet).toMatch(
      /@container voice-rail \(max-width: 520px\)[\s\S]*?\.voice-rail-presence\s*\{[^}]*min-width:[^}]+\}[\s\S]*?\.voice-rail-operation--idle\s*\{[^}]*display:\s*none;/,
    );
  });

  it('cuts a long work title short instead of painting it over the button beside it', () => {
    expect(stylesheet).toMatch(
      /\.voice-rail-work-copy strong\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
    );
  });

  it('moves the work onto its own row when the rail is as narrow as the floating composer', () => {
    expect(stylesheet).toMatch(
      /@container voice-rail \(max-width: 520px\)[\s\S]*?\.voice-rail\s*\{[^}]*grid-template-areas:[^}]*'work work work'/,
    );
  });
});
