/**
 * An answered Question in the terminal transcript: once the dialog closes, the
 * transcript still shows each question and what the person chose.
 */
import { Writable } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import type { ToolCallRequestedEvent, ToolResultEvent } from '@moxxy/sdk';
import { ToolCallBlock } from './ToolCallBlock.js';

function frame(node: React.ReactElement): string {
  let out = '';
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        out = String(chunk);
        done();
      },
    }),
    { columns: 100, rows: 40, isTTY: false },
  );
  const app = render(node, { stdout: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false });
  app.unmount();
  return out;
}

const request = { type: 'tool_call_requested', name: 'ask_user', input: {}, callId: 'c1' } as unknown as ToolCallRequestedEvent;
const outcome = {
  type: 'tool_result',
  callId: 'c1',
  ok: true,
  output: {
    forModel: 'The user answered: …',
    display: {
      kind: 'question-answer',
      questions: [
        { header: 'Colour', question: 'Which colour?', chosen: ['Blue'] },
        { question: 'Which parts?', chosen: ['Auth'], own: 'and the admin page' },
      ],
    },
  },
} as unknown as ToolResultEvent;

describe('ToolCallBlock', () => {
  it('shows what the person chose for an answered Question, without expanding', () => {
    const text = frame(React.createElement(ToolCallBlock, { request, outcome }));

    expect(text).toContain('You answered');
    expect(text).toContain('Colour: Which colour? → Blue');
    expect(text).toContain('Which parts? → Auth; own answer: and the admin page');
    expect(text).not.toContain('The user answered');
  });
});

describe('ToolCallBlock with an image result', () => {
  const shot = {
    type: 'tool_result',
    callId: 'c2',
    ok: true,
    output: { forModel: 'Arc, tests.html', mediaType: 'image/jpeg', base64: 'A'.repeat(3000) },
  } as unknown as ToolResultEvent;
  const call = { type: 'tool_call_requested', name: 'view_image', input: { path: 'shot.jpg' }, callId: 'c2' } as unknown as ToolCallRequestedEvent;

  it('says an image came back, its kind and size and its text, never the image as text', () => {
    const text = frame(React.createElement(ToolCallBlock, { request: call, outcome: shot, expanded: true }));

    expect(text).toContain('Result · image (JPEG, 2.2 KB) · Arc, tests.html');
    expect(text).not.toContain('AAAA');
  });

  it('counts every image when a tool returned several', () => {
    const shots = { ...shot, output: { forModel: 'Two windows', mediaType: 'image/jpeg', base64: 'A'.repeat(3000), moreImages: [{ mediaType: 'image/jpeg', base64: 'B'.repeat(3000) }] } } as unknown as ToolResultEvent;
    const text = frame(React.createElement(ToolCallBlock, { request: call, outcome: shots, expanded: true }));

    expect(text).toContain('Result · 2 images (JPEG, 4.4 KB) · Two windows');
  });
});
