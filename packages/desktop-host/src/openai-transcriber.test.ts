import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStaticKeySource, VaultStore } from '@moxxy/plugin-vault';
import {
  OPENAI_API_KEY_NAME,
  OPENAI_TRANSCRIBE_MODEL,
  createOpenAiTranscriber,
} from './openai-transcriber';

interface Seen {
  readonly authorization: string | undefined;
  readonly body: string;
}

/** OpenAI's transcription endpoint stands in as a loopback server: the one
 *  external boundary here. Everything else (vault, transcriber) is real. */
async function startOpenAi(): Promise<{ server: Server; baseURL: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ authorization: request.headers.authorization, body: Buffer.concat(chunks).toString('latin1') });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ text: 'run the tests' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseURL: `http://127.0.0.1:${port}/v1`, seen };
}

describe('createOpenAiTranscriber', () => {
  let vault: VaultStore;
  let openai: Awaited<ReturnType<typeof startOpenAi>>;

  beforeEach(async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'openai-stt-'));
    vault = new VaultStore({ filePath: path.join(dir, 'vault.json'), keySource: createStaticKeySource(Buffer.alloc(32, 7)) });
    openai = await startOpenAi();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => openai.server.close(() => resolve()));
  });

  it('transcribes with the current OpenAI model on the key saved in the vault', async () => {
    await vault.set(OPENAI_API_KEY_NAME, 'sk-test-key');
    const transcriber = createOpenAiTranscriber({ vault, baseURL: openai.baseURL });

    const result = await transcriber.transcribe(new Uint8Array([1, 2, 3, 4]), { mimeType: 'audio/webm' });

    expect(result.text).toBe('run the tests');
    expect(OPENAI_TRANSCRIBE_MODEL).toBe('gpt-transcribe');
    expect(openai.seen).toHaveLength(1);
    expect(openai.seen[0]?.authorization).toBe('Bearer sk-test-key');
    expect(openai.seen[0]?.body).toContain('gpt-transcribe');
  });

  it('asks for the key instead of reaching for a ChatGPT login when none is saved', async () => {
    const transcriber = createOpenAiTranscriber({ vault, baseURL: openai.baseURL });

    await expect(transcriber.transcribe(new Uint8Array([1]), { mimeType: 'audio/webm' }))
      .rejects.toThrow(/Choose a transcription in Settings → Voice and add your OpenAI API key/);
    expect(openai.seen).toHaveLength(0);
  });

  it('picks up a key saved after it was created', async () => {
    const transcriber = createOpenAiTranscriber({ vault, baseURL: openai.baseURL });
    await expect(transcriber.transcribe(new Uint8Array([1]))).rejects.toThrow();

    await vault.set(OPENAI_API_KEY_NAME, 'sk-later');
    await transcriber.transcribe(new Uint8Array([1]), { mimeType: 'audio/webm' });

    expect(openai.seen.at(-1)?.authorization).toBe('Bearer sk-later');
  });
});
