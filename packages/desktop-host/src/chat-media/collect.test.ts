import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { ChatMediaCollector } from './collect';

let nextSeq = 0;
function ev<T extends MoxxyEvent['type']>(
  type: T,
  body: Omit<
    Extract<MoxxyEvent, { type: T }>,
    'id' | 'seq' | 'ts' | 'sessionId' | 'turnId' | 'source' | 'type'
  >,
  ts = 1_760_000_000_000 + nextSeq,
): MoxxyEvent {
  const seq = nextSeq++;
  return {
    id: `e${seq}`,
    seq,
    ts,
    sessionId: 's1',
    turnId: 't1',
    source: type === 'user_prompt' ? 'user' : 'model',
    type,
    ...body,
  } as unknown as MoxxyEvent;
}

const PNG_A = Buffer.from('first image bytes').toString('base64');
const PNG_B = Buffer.from('second image bytes').toString('base64');
const PNG_C = Buffer.from('third image bytes').toString('base64');
const PNG_D = Buffer.from('a photo like the first').toString('base64');

function collect(events: ReadonlyArray<MoxxyEvent>): ChatMediaCollector {
  const collector = new ChatMediaCollector();
  events.forEach((event, i) => collector.add(event, { offset: i * 100, length: 100 }));
  return collector;
}

const items = (collector: ChatMediaCollector) => collector.entries().map((entry) => entry.item);

describe('ChatMediaCollector', () => {
  beforeEach(() => {
    nextSeq = 0;
  });

  it('lists the photos and files the person attached, newest first, without their bytes', () => {
    const collector = collect([
      ev('user_prompt', {
        text: 'look at these',
        attachments: [
          { kind: 'image', content: PNG_A, name: 'cat.png', mediaType: 'image/png' },
          {
            kind: 'document',
            content: Buffer.from('%PDF').toString('base64'),
            name: 'Umowa.pdf',
            mediaType: 'application/pdf',
          },
          { kind: 'audio', content: 'a voice note transcript', name: 'voice.ogg' },
        ],
      }),
    ]);
    expect(items(collector)).toEqual([
      expect.objectContaining({
        kind: 'file',
        owner: 'me',
        name: 'Umowa.pdf',
        mediaType: 'application/pdf',
        bytes: 4,
        path: null,
      }),
      expect.objectContaining({
        kind: 'image',
        owner: 'me',
        name: 'cat.png',
        mediaType: 'image/png',
        bytes: 17,
        caption: 'look at these',
      }),
    ]);
    expect(JSON.stringify(collector.toJSON())).not.toContain(PNG_A);
  });

  it('counts a link only when the message makes it clickable, from the person and from the agent', () => {
    const collector = collect([
      ev('user_prompt', { text: 'check https://example.com/docs and www.moxxy.ai' }),
      ev('assistant_message', {
        stopReason: 'end_turn',
        content: [
          'The [release notes](https://github.com/moxxy/releases) say so.',
          '',
          'Run `curl https://in-inline-code.example` or:',
          '',
          '```sh',
          'open https://in-a-code-block.example',
          '```',
          '',
          'Mail me at someone@example.com, see <https://angle.example/x>.',
        ].join('\n'),
      }),
    ]);
    expect(
      items(collector).map((item) => (item.kind === 'link' ? [item.owner, item.url, item.label] : item.kind)),
    ).toEqual([
      ['agent', 'https://angle.example/x', null],
      ['agent', 'https://github.com/moxxy/releases', 'release notes'],
      ['me', 'http://www.moxxy.ai/', null],
      ['me', 'https://example.com/docs', null],
    ]);
  });

  it('keeps explicit internal URLs while ignoring a bare www word', () => {
    const collector = collect([
      ev('assistant_message', {
        stopReason: 'end_turn',
        content:
          'Not a dedicated www. page, see http://intranet too; but http://localhost:5173 and https://192.168.1.4/x are.',
      }),
    ]);
    expect(items(collector).map((item) => (item.kind === 'link' ? item.url : item.kind))).toEqual([
      'https://192.168.1.4/x',
      'http://localhost:5173/',
      'http://intranet/',
    ]);
  });

  it('includes clickable reference links, but not unused definitions or image URLs', () => {
    const collector = collect([
      ev('assistant_message', {
        stopReason: 'end_turn',
        content:
          '[Read the guide][guide].\n\n[guide]: https://guide.example/start\n[unused]: https://unused.example\n\n![photo](https://image.example/a.png)',
      }),
    ]);
    expect(items(collector)).toEqual([
      expect.objectContaining({ kind: 'link', url: 'https://guide.example/start', label: 'Read the guide' }),
    ]);
  });

  it('gives a link the words of the line it sat in, for the search', () => {
    const collector = collect([
      ev('assistant_message', {
        stopReason: 'end_turn',
        content: 'Intro.\n\n- Tickets for the concert: https://tickets.example/visual\n- Other',
      }),
    ]);
    expect(items(collector)[0]).toMatchObject({
      kind: 'link',
      caption: 'Tickets for the concert: https://tickets.example/visual',
    });
  });

  it('shows a link sent many times once, at its newest message', () => {
    const collector = collect([
      ev('assistant_message', { stopReason: 'end_turn', content: 'see https://same.example/page' }, 10),
      ev('assistant_message', { stopReason: 'end_turn', content: 'other https://other.example' }, 20),
      ev('assistant_message', { stopReason: 'end_turn', content: 'again https://same.example/page' }, 30),
    ]);
    expect(items(collector).map((item) => (item.kind === 'link' ? [item.url, item.ts] : null))).toEqual([
      ['https://same.example/page', 30],
      ['https://other.example/', 20],
    ]);
  });

  it('files a link to a file on this computer under files, as the agent wrote it', () => {
    // A path of the platform the test runs on: `file:///Users/…` names no drive
    // on Windows, so there it is no file on this computer.
    const home = process.platform === 'win32' ? 'C:\\Users\\me' : '/Users/me';
    const report = path.join(home, 'report.pdf');
    const notes = path.join(home, 'notes v2.md');
    const reportLink = process.platform === 'win32' ? pathToFileURL(report).href : report;
    const collector = collect([
      ev('assistant_message', {
        stopReason: 'end_turn',
        content: `Saved [the report](${reportLink}) and [notes](${pathToFileURL(notes).href}).`,
      }),
    ]);
    expect(items(collector)).toEqual([
      expect.objectContaining({
        kind: 'file',
        owner: 'agent',
        name: 'notes v2.md',
        path: notes,
        id: `f:${notes}`,
      }),
      expect.objectContaining({
        kind: 'file',
        owner: 'agent',
        name: 'report.pdf',
        path: report,
      }),
    ]);
  });

  it('keeps each image the agent was shown once, however often it came back', () => {
    const collector = collect([
      ev('tool_call_requested', {
        callId: 'c1' as never,
        name: 'browser_capture',
        input: { url: 'https://shop.example/cart' },
      }),
      ev('tool_result', {
        callId: 'c1' as never,
        ok: true,
        output: { mediaType: 'image/png', base64: PNG_A, forModel: 'The cart page' },
      }),
      ev('tool_call_requested', { callId: 'c2' as never, name: 'browser_capture', input: {} }),
      ev('tool_result', {
        callId: 'c2' as never,
        ok: true,
        output: {
          mediaType: 'image/png',
          base64: PNG_B,
          moreImages: [{ mediaType: 'image/png', base64: PNG_A }],
        },
      }),
    ]);
    const images = items(collector);
    expect(images).toHaveLength(2);
    expect(images).toEqual([
      expect.objectContaining({ kind: 'image', owner: 'agent', id: 't:3:1', seq: 3 }),
      expect.objectContaining({ kind: 'image', owner: 'agent', id: 't:3:0', seq: 3 }),
    ]);
    expect(images[1]).toMatchObject({ caption: 'browser_capture' });
  });

  it('does not discard a distinct image just because its fingerprint differs in only one bit', () => {
    const collector = new ChatMediaCollector(undefined, {
      fingerprint: (base64) => (base64 === PNG_A ? '0'.repeat(64) : `${'0'.repeat(63)}1`),
    });
    [PNG_A, PNG_B].forEach((base64, seq) =>
      collector.add(
        ev('tool_result', {
          callId: `c${seq}` as never,
          ok: true,
          output: { mediaType: 'image/png', base64 },
        }),
        { offset: seq, length: 1 },
      ),
    );
    expect(items(collector)).toHaveLength(2);
  });

  it("shows identical rendered screenshots once, at the newest, but keeps the person's own photos", () => {
    // Stands in for Electron's decoding: what each image looks like, as bits.
    const looks: Record<string, string> = {
      [PNG_A]: '0'.repeat(64),
      [PNG_B]: '0'.repeat(64), // The same pixels in a different encoding.
      [PNG_C]: 'f'.repeat(64), // another screen
      [PNG_D]: '0'.repeat(64), // looks just like A
    };
    const collector = new ChatMediaCollector(undefined, { fingerprint: (base64) => looks[base64] ?? null });
    const shot = (callId: string, base64: string): MoxxyEvent =>
      ev('tool_result', { callId: callId as never, ok: true, output: { mediaType: 'image/png', base64 } });
    [
      shot('c1', PNG_A),
      shot('c2', PNG_C),
      shot('c3', PNG_B),
      ev('user_prompt', {
        text: '',
        attachments: [{ kind: 'image', content: PNG_A, name: 'a.png', mediaType: 'image/png' }],
      }),
      ev('user_prompt', {
        text: '',
        attachments: [{ kind: 'image', content: PNG_D, name: 'd.png', mediaType: 'image/png' }],
      }),
    ].forEach((event, i) => collector.add(event, { offset: i, length: 1 }));
    expect(items(collector).map((item) => [item.owner, item.id])).toEqual([
      ['me', 'a:4:0'],
      ['me', 'a:3:0'],
      ['agent', 't:2:0'],
      ['agent', 't:1:0'],
    ]);
  });

  it('keeps the words of the call that made an image', () => {
    const collector = collect([
      ev('tool_call_requested', {
        callId: 'c1' as never,
        name: 'browser_capture',
        input: { url: 'https://shop.example/cart' },
      }),
      ev('tool_result', {
        callId: 'c1' as never,
        ok: true,
        output: { mediaType: 'image/png', base64: PNG_A, forModel: 'The cart page' },
      }),
    ]);
    expect(items(collector)[0]).toMatchObject({
      caption: 'browser_capture https://shop.example/cart The cart page',
    });
  });

  it('leaves a photo the person sent theirs when the agent looks at it again', () => {
    const collector = collect([
      ev('user_prompt', {
        text: '',
        attachments: [{ kind: 'image', content: PNG_A, name: 'me.png', mediaType: 'image/png' }],
      }),
      ev('tool_result', {
        callId: 'c9' as never,
        ok: true,
        output: { type: 'image', mediaType: 'image/png', data: PNG_A },
      }),
    ]);
    expect(items(collector)).toEqual([expect.objectContaining({ owner: 'me', id: 't:1:0', name: 'me.png' })]);
  });

  it('takes nothing from prompts a trigger wrote, from failed tools or from streamed chunks', () => {
    const collector = collect([
      ev('user_prompt', {
        text: 'webhook body https://hook.example',
        origin: { kind: 'webhook', name: 'gh' },
      }),
      ev('tool_result', {
        callId: 'c1' as never,
        ok: false,
        output: { mediaType: 'image/png', base64: PNG_A },
      }),
      ev('assistant_chunk', { delta: 'https://chunk.example' }),
    ]);
    expect(items(collector)).toEqual([]);
  });

  it('carries on from where it stopped after a round trip through JSON', () => {
    const first = collect([
      ev('tool_call_requested', { callId: 'c1' as never, name: 'computer_screenshot', input: {} }),
    ]);
    const resumed = ChatMediaCollector.fromJSON(JSON.parse(JSON.stringify(first.toJSON())));
    resumed.add(
      ev('tool_result', {
        callId: 'c1' as never,
        ok: true,
        output: { mediaType: 'image/png', base64: PNG_B },
      }),
      {
        offset: 500,
        length: 90,
      },
    );
    expect(resumed.entries()).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ caption: 'computer_screenshot' }),
        at: { offset: 500, length: 90 },
        index: 0,
      }),
    ]);
  });
});
