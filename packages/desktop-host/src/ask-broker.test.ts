import { expect, it } from 'vitest';
import { answerAsk, openAsk } from './ask-broker';

it('cancels only the stopped turn and ignores its late approval', async () => {
  const a = new AbortController(); const b = new AbortController();
  const ids: string[] = [];
  const resolved: string[] = [];
  const send: Parameters<typeof openAsk>[1] = (channel, payload) => {
    if (channel === 'ask.request') ids.push(payload.requestId);
    else resolved.push(payload.requestId);
  };
  const first = openAsk({ workspaceId: 'workspace', kind: 'permission' }, send, a.signal);
  const second = openAsk({ workspaceId: 'workspace', kind: 'permission' }, send, b.signal);
  a.abort();
  expect(resolved).toEqual([ids[0]]);
  await expect(first).resolves.toEqual({ mode: 'deny' });
  if (!ids[0] || !ids[1]) throw new Error('Missing request ids');
  answerAsk(ids[0], { mode: 'allow_always' });
  answerAsk(ids[1], { mode: 'allow' });
  await expect(second).resolves.toEqual({ mode: 'allow' });
});
