import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runTurn, type Session } from '@moxxy/core';
import type { MoxxyEvent } from '@moxxy/sdk';

export const turnRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
});

export type TurnRequest = z.infer<typeof turnRequestSchema>;

export interface RouterContext {
  readonly session: Session;
  readonly authToken: string | null;
  readonly logger?: { warn(msg: string, meta?: Record<string, unknown>): void };
}

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, ctx: RouterContext) => Promise<void>;

/** Match HTTP request to a handler. Returns null if no route matches. */
export function routeRequest(req: IncomingMessage): RouteHandler | null {
  const url = req.url ?? '/';
  if (req.method === 'GET' && url === '/v1/health') return handleHealth;
  if (req.method === 'POST' && url === '/v1/turn') return handleTurn;
  if (req.method === 'POST' && url === '/v1/turn/stream') return handleTurnStream;
  return null;
}

export async function handleHealth(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}

function checkAuth(req: IncomingMessage, expected: string | null): boolean {
  if (!expected) return true;
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${expected}`;
}

async function readBody(req: IncomingMessage, max = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function handleTurn(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  if (!checkAuth(req, ctx.authToken)) {
    reply(res, 401, { error: 'unauthorized' });
    return;
  }

  let body: TurnRequest;
  try {
    const raw = await readBody(req);
    body = turnRequestSchema.parse(JSON.parse(raw));
  } catch (err) {
    reply(res, 400, { error: 'bad_request', message: err instanceof Error ? err.message : String(err) });
    return;
  }

  const events: MoxxyEvent[] = [];
  try {
    for await (const event of runTurn(ctx.session, body.prompt, {
      ...(body.model ? { model: body.model } : {}),
      ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
    })) {
      events.push(event);
    }
  } catch (err) {
    reply(res, 500, { error: 'turn_failed', message: err instanceof Error ? err.message : String(err) });
    return;
  }

  const finalAssistant = events.findLast?.((e) => e.type === 'assistant_message');
  const assistant =
    finalAssistant && finalAssistant.type === 'assistant_message' ? finalAssistant.content : '';
  reply(res, 200, { events, assistant });
}

export async function handleTurnStream(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  if (!checkAuth(req, ctx.authToken)) {
    reply(res, 401, { error: 'unauthorized' });
    return;
  }

  let body: TurnRequest;
  try {
    const raw = await readBody(req);
    body = turnRequestSchema.parse(JSON.parse(raw));
  } catch (err) {
    reply(res, 400, { error: 'bad_request', message: err instanceof Error ? err.message : String(err) });
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const writeEvent = (event: MoxxyEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    for await (const event of runTurn(ctx.session, body.prompt, {
      ...(body.model ? { model: body.model } : {}),
      ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
    })) {
      writeEvent(event);
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : String(err) })}\n\n`);
  } finally {
    res.end();
  }
}
