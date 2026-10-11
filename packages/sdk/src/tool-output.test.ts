import { describe, expect, it } from 'vitest';
import { toolOutputForModel } from './tool-output.js';

describe('what the model sees of a tool output', () => {
  it('passes text through as it is', () => {
    expect(toolOutputForModel('hello')).toEqual({ text: 'hello', image: null });
  });

  it('writes other values as JSON', () => {
    expect(toolOutputForModel({ n: 1 })).toEqual({ text: '{"n":1}', image: null });
  });

  it('survives a value JSON cannot write', () => {
    const loop: { self?: unknown } = {};
    loop.self = loop;
    expect(toolOutputForModel(loop).text).toBe('[object Object]');
  });

  it('gives only the short summary of a rich result', () => {
    const output = {
      forModel: 'Colour: Blue',
      display: { kind: 'question-answer', questions: [{ question: 'Which colour?', chosen: ['Blue'] }] },
    };
    expect(toolOutputForModel(output)).toEqual({ text: 'Colour: Blue', image: null });
  });

  it('hands an image over as pixels, with its description when the tool gave one', () => {
    expect(toolOutputForModel({ mediaType: 'image/png', base64: 'AAA', forModel: 'Screen 1440x900' })).toEqual({
      text: 'Screen 1440x900',
      image: { type: 'image', mediaType: 'image/png', data: 'AAA' },
    });
    expect(toolOutputForModel({ type: 'image', mediaType: 'image/jpeg', data: 'BBB' })).toEqual({
      text: '[image returned by tool — see attached image]',
      image: { type: 'image', mediaType: 'image/jpeg', data: 'BBB' },
    });
  });
});
