import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type {
  ClientSession,
  ModelDescriptor,
  ProviderDef,
  UserPromptAttachment,
} from '@moxxy/sdk';
import type { OfficeAgentRuntime } from './office-agent-runtime.js';
import { eventToVirtualOfficeEnvelope, type VirtualOfficeEnvelope } from './virtual-office-events.js';
import type { HttpPermissionBroker } from './permission-broker.js';

export type OfficeLogger = { warn(msg: string, meta?: Record<string, unknown>): void };

/** A crash-safe SSE writer handed to the events route by the channel. */
export interface OfficeEventStream {
  /** Write one JSON envelope as an SSE `data:` frame; never throws. */
  send(data: unknown): void;
  /** Resolves when the client disconnects (and the stream is torn down). */
  readonly closed: Promise<void>;
}

/**
 * Per-request context the channel hands each office route. It mirrors the
 * generic shape a network channel provides — the live session, the office
 * runtime + (optional) permission broker, the raw req/res, path helpers, a
 * size-capped body reader, a JSON `reply`, and a crash-safe SSE opener. The
 * channel has already enforced bearer auth before any route sees this.
 */
export interface OfficeRequestContext {
  readonly session: ClientSession;
  readonly runtime: OfficeAgentRuntime;
  readonly broker: HttpPermissionBroker | null;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly pathname: string;
  readonly logger?: OfficeLogger;
  /** Path segment by index (`/v1/agents/abc` → `pathSegment(3) === 'abc'`). */
  pathSegment(n: number): string;
  /** Read the body as UTF-8, rejecting once `max` bytes (default 64 KiB) is exceeded. */
  readBody(max?: number): Promise<string>;
  /** Send a JSON response with the given status. */
  reply(status: number, body: unknown): void;
  /** Begin a crash-safe SSE stream on the response. */
  openEventStream(): OfficeEventStream;
}

export interface OfficeRoute {
  readonly method: 'GET' | 'POST' | 'DELETE';
  match(pathname: string): boolean;
  handle(ctx: OfficeRequestContext): Promise<void>;
}

// Virtual Office attachment caps. A single base64-encoded image is bounded at
// 10 MB of decoded bytes; an agent run carries at most 4 of them. The body cap
// covers four maxed-out base64 images (4/3 expansion) plus 1 MB of slack for
// the surrounding JSON, so the body-size guard rejects abuse before we ever
// `JSON.parse` it.
const IMAGE_ATTACHMENT_MAX = 10 * 1024 * 1024;
const AGENT_RUN_BODY_MAX = 4 * Math.ceil((IMAGE_ATTACHMENT_MAX * 4) / 3) + 1024 * 1024;

const imageAttachmentSchema = z
  .object({
    kind: z.literal('image'),
    content: z.string().min(1),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    name: z.string().optional(),
  })
  .superRefine((attachment, ctx) => {
    const size = Buffer.from(attachment.content, 'base64').length;
    if (size > IMAGE_ATTACHMENT_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'image attachment exceeds 10 MB',
        path: ['content'],
      });
    }
  });

const agentRunRequestSchema = z.object({
  task: z.string().min(1),
  attachments: z.array(imageAttachmentSchema).max(4).optional(),
});

const agentCreateRequestSchema = z.object({
  name: z.string().optional(),
  agent_type: z.string().optional(),
  instructions: z.string().optional(),
  model: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
});

const permissionDecisionSchema = z.object({
  mode: z.enum(['allow', 'allow_session', 'allow_always', 'deny']),
  reason: z.string().optional(),
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The Virtual Office route table, ordered most-specific-first within each
 * method. The channel matches by `method` + `match(pathname)` AFTER its bearer
 * check, then hands the matched route an {@link OfficeRequestContext}. Every
 * handler that mutates state validates its own body with zod; the agent-run /
 * image path is additionally size-capped before parse.
 */
export const OFFICE_ROUTES: ReadonlyArray<OfficeRoute> = [
  {
    method: 'GET',
    match: (p) => p === '/v1/graveyard',
    async handle(ctx) {
      ctx.reply(200, ctx.runtime.graveyard());
    },
  },
  {
    method: 'GET',
    match: (p) => p === '/v1/agents',
    async handle(ctx) {
      ctx.reply(200, ctx.runtime.list());
    },
  },
  {
    method: 'POST',
    match: (p) => p === '/v1/agents',
    async handle(ctx) {
      let input: z.infer<typeof agentCreateRequestSchema>;
      try {
        const raw = await ctx.readBody();
        input = agentCreateRequestSchema.parse(raw.trim() ? JSON.parse(raw) : {});
      } catch (err) {
        ctx.reply(400, { error: 'bad_request', message: errMsg(err) });
        return;
      }
      ctx.reply(200, await ctx.runtime.create(input));
    },
  },
  {
    method: 'GET',
    match: (p) => /^\/v1\/agents\/[^/]+$/.test(p),
    async handle(ctx) {
      const agent = ctx.runtime.get(ctx.pathSegment(3));
      if (!agent) {
        ctx.reply(404, { error: 'not_found', message: 'agent not found' });
        return;
      }
      ctx.reply(200, agent);
    },
  },
  {
    method: 'DELETE',
    match: (p) => /^\/v1\/agents\/[^/]+$/.test(p),
    async handle(ctx) {
      const id = ctx.pathSegment(3);
      if (id === 'session') {
        ctx.reply(409, { error: 'unsupported', message: 'the active moxxy session cannot be dismissed' });
        return;
      }
      const dismissed = await ctx.runtime.dismiss(id);
      if (!dismissed) {
        ctx.reply(404, { error: 'not_found', message: 'agent not found' });
        return;
      }
      ctx.reply(200, { ok: true });
    },
  },
  {
    method: 'POST',
    match: (p) => /^\/v1\/agents\/[^/]+\/runs$/.test(p),
    async handle(ctx) {
      await handleAgentRun(ctx);
    },
  },
  {
    method: 'POST',
    match: (p) => /^\/v1\/agents\/[^/]+\/stop$/.test(p),
    async handle(ctx) {
      const result = ctx.runtime.stop(ctx.pathSegment(3));
      if (result === 'unsupported') {
        ctx.reply(409, {
          error: 'unsupported',
          message: 'the active moxxy session cannot be stopped through this endpoint',
        });
        return;
      }
      if (result === 'not_found') {
        ctx.reply(404, { error: 'not_found', message: 'agent not found' });
        return;
      }
      if (result === 'not_running') {
        ctx.reply(409, { error: 'not_running', message: 'agent has no active run' });
        return;
      }
      ctx.reply(200, { ok: true });
    },
  },
  {
    method: 'GET',
    match: (p) => /^\/v1\/agents\/[^/]+\/history$/.test(p),
    async handle(ctx) {
      const id = ctx.pathSegment(3);
      if (id === 'session') {
        ctx.reply(200, historyFromSessionLog(ctx.session, readHistoryLimit(ctx)));
        return;
      }
      const history = ctx.runtime.history(id);
      if (!history) {
        ctx.reply(404, { error: 'not_found', message: 'agent not found' });
        return;
      }
      ctx.reply(200, history);
    },
  },
  {
    method: 'POST',
    match: (p) => /^\/v1\/agents\/[^/]+\/reset$/.test(p),
    async handle(ctx) {
      const id = ctx.pathSegment(3) || 'session';
      const agent = ctx.runtime.reset(id);
      if (!agent) {
        ctx.reply(404, { error: 'not_found', message: 'agent not found' });
        return;
      }
      ctx.reply(200, { agent_name: agent.name, status: agent.status });
    },
  },
  {
    method: 'GET',
    match: (p) => p === '/v1/events/stream',
    async handle(ctx) {
      await handleEvents(ctx, ctx.runtime, ctx.logger);
    },
  },
  {
    method: 'POST',
    match: (p) => /^\/v1\/permissions\/[^/]+\/decision$/.test(p),
    async handle(ctx) {
      if (!ctx.broker) {
        ctx.reply(404, { error: 'not_found', message: 'interactive permissions are not enabled' });
        return;
      }
      let body: z.infer<typeof permissionDecisionSchema>;
      try {
        const raw = await ctx.readBody();
        body = permissionDecisionSchema.parse(JSON.parse(raw));
      } catch (err) {
        ctx.reply(400, { error: 'bad_request', message: errMsg(err) });
        return;
      }
      const ok = await ctx.broker.decide(ctx.pathSegment(3), body);
      if (!ok) {
        ctx.reply(404, { error: 'not_found', message: 'permission request not found' });
        return;
      }
      ctx.reply(200, { ok: true });
    },
  },
];

// ---------------------------------------------------------------------------
// Agent-run handling (size-capped body, attachment materialization).
// ---------------------------------------------------------------------------

async function handleAgentRun(ctx: OfficeRequestContext): Promise<void> {
  const runtime = ctx.runtime;
  // Size-cap the body BEFORE parsing: an agent run may carry up to four 10 MB
  // base64 images, so the cap is generous but finite — anything past it is
  // rejected at the transport rather than buffered into memory.
  let body: z.infer<typeof agentRunRequestSchema>;
  try {
    const raw = await ctx.readBody(AGENT_RUN_BODY_MAX);
    body = agentRunRequestSchema.parse(JSON.parse(raw));
  } catch (err) {
    ctx.reply(400, { error: 'bad_request', message: errMsg(err) });
    return;
  }

  const agentId = ctx.pathSegment(3) || 'session';
  const attachments = body.attachments ?? [];

  if (agentId !== 'session') {
    const agent = runtime.get(agentId);
    if (!agent) {
      ctx.reply(404, { error: 'not_found', message: 'agent not found' });
      return;
    }
    if (
      imageAttachments(attachments).length > 0 &&
      !supportsImageAttachments(ctx.session, agent.provider_id, agent.model_id)
    ) {
      ctx.reply(400, {
        error: 'unsupported_attachments',
        message: `model ${agent.provider_id}::${agent.model_id} does not support image attachments`,
      });
      return;
    }
    let toolSystemPrompt: string | undefined;
    try {
      toolSystemPrompt = await imageAttachmentToolHint(ctx.session, attachments);
    } catch (err) {
      ctx.logger?.warn('virtual office attachment materialization failed', { err: errMsg(err) });
      ctx.reply(500, {
        error: 'attachment_materialization_failed',
        message: 'failed to prepare image attachments for tools',
      });
      return;
    }
    const started = runtime.startRun(
      agentId,
      body.task,
      attachments,
      toolSystemPrompt ? { systemPrompt: toolSystemPrompt } : undefined,
    );
    if (started === 'not_found') {
      ctx.reply(404, { error: 'not_found', message: 'agent not found' });
      return;
    }
    if (started === 'already_running') {
      ctx.reply(409, { error: 'already_running', message: 'agent already has an active run' });
      return;
    }
    ctx.reply(200, started);
    return;
  }

  // The `session` pseudo-agent runs against the channel's live session.
  if (imageAttachments(attachments).length > 0 && !supportsImageAttachments(ctx.session)) {
    const modelInfo = activeModelInfo(ctx.session);
    ctx.reply(400, {
      error: 'unsupported_attachments',
      message: `model ${modelInfo.providerId}::${modelInfo.modelId} does not support image attachments`,
    });
    return;
  }

  let toolSystemPrompt: string | undefined;
  try {
    toolSystemPrompt = await imageAttachmentToolHint(ctx.session, attachments);
  } catch (err) {
    ctx.logger?.warn('virtual office attachment materialization failed', { err: errMsg(err) });
    ctx.reply(500, {
      error: 'attachment_materialization_failed',
      message: 'failed to prepare image attachments for tools',
    });
    return;
  }

  void (async () => {
    try {
      for await (const event of ctx.session.runTurn(body.task, {
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(toolSystemPrompt ? { systemPrompt: toolSystemPrompt } : {}),
      })) {
        void event;
      }
    } catch (err) {
      ctx.logger?.warn('virtual office run failed', { err: errMsg(err) });
    }
  })();

  ctx.reply(200, {
    agent_id: agentId,
    run_id: null,
    task: body.task,
    status: 'running',
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}

/**
 * Server-Sent Events stream of the unified Virtual Office timeline. Both the
 * live session log and the office runtime are normalized into
 * {@link VirtualOfficeEnvelope}s; envelopes flagged `sensitive` (tokens,
 * secrets) are dropped before write so they never reach the wire — a flag that
 * is office-envelope-specific and therefore enforced here.
 */
export async function handleEvents(
  ctx: OfficeRequestContext,
  runtime: OfficeAgentRuntime,
  logger?: OfficeLogger,
): Promise<void> {
  const stream = ctx.openEventStream();

  const writeEnvelope = (envelope: VirtualOfficeEnvelope): void => {
    // Honor the producer's `sensitive` flag: such payloads (e.g. secrets) must
    // never stream to clients. The channel's `send` is already crash-safe (a
    // failed write is logged + dropped), so this only adds the office-specific
    // sensitivity drop.
    if (envelope.sensitive) return;
    stream.send(envelope);
  };

  const unsubscribe = ctx.session.log.subscribe((event) => {
    const envelope = eventToVirtualOfficeEnvelope(event, 'session');
    if (!envelope) return;
    writeEnvelope(envelope);
  });
  const unsubscribeOffice = runtime.subscribe((envelope) => {
    writeEnvelope(envelope);
  });
  void logger;

  try {
    await stream.closed;
  } finally {
    unsubscribe();
    unsubscribeOffice();
  }
}

// ---------------------------------------------------------------------------
// Office-specific helpers (model capabilities, attachment materialization,
// session-log history projection).
// ---------------------------------------------------------------------------

function readHistoryLimit(ctx: OfficeRequestContext): number {
  const url = new URL(ctx.req.url ?? '/', 'http://localhost');
  const raw = Number(url.searchParams.get('limit') ?? 50);
  if (!Number.isInteger(raw) || raw < 1) return 50;
  return Math.min(raw, 500);
}

function activeModelInfo(
  session: ClientSession,
  providerId?: string,
  modelId?: string,
): { provider: ProviderDef | null; providerId: string; model: ModelDescriptor | null; modelId: string } {
  const activeName = session.providers.getActiveName();
  const providers = session.providers.list();
  const provider =
    providers.find((entry) => entry.name === providerId) ??
    providers.find((entry) => entry.name === activeName) ??
    providers[0] ??
    null;
  const model = provider?.models.find((entry) => entry.id === modelId) ?? provider?.models[0] ?? null;
  return {
    provider,
    providerId: provider?.name ?? providerId ?? activeName ?? 'none',
    model,
    modelId: model?.id ?? modelId ?? 'default',
  };
}

type ImagePromptAttachment = UserPromptAttachment & {
  kind: 'image';
  content: string;
  mediaType: string;
  name?: string;
};

interface MaterializedImageAttachment {
  readonly name: string;
  readonly mediaType: string;
  readonly path: string;
}

function imageAttachments(
  attachments: ReadonlyArray<UserPromptAttachment> | undefined,
): ReadonlyArray<ImagePromptAttachment> {
  return (attachments ?? []).filter(
    (attachment): attachment is ImagePromptAttachment => attachment.kind === 'image',
  );
}

function supportsImageAttachments(session: ClientSession, providerId?: string, modelId?: string): boolean {
  return activeModelInfo(session, providerId, modelId).model?.supportsImages === true;
}

/**
 * Write base64 image attachments to per-session media files so tools that need a
 * local path (rather than inline bytes) can reach them. Returns a system-prompt
 * hint listing the materialized paths, or undefined when there are no images.
 */
async function imageAttachmentToolHint(
  session: ClientSession,
  attachments: ReadonlyArray<UserPromptAttachment>,
): Promise<string | undefined> {
  const images = imageAttachments(attachments);
  if (images.length === 0) return undefined;

  const dir = path.join(moxxyHome(), 'media', String(session.id));
  await mkdir(dir, { recursive: true });

  const files: MaterializedImageAttachment[] = [];
  for (const [index, attachment] of images.entries()) {
    const filename = attachmentFilename(attachment, index);
    const filePath = path.join(dir, filename);
    await writeFile(filePath, Buffer.from(attachment.content, 'base64'), { flag: 'wx' });
    files.push({
      name: safeAttachmentDisplayName(attachment.name, filename),
      mediaType: attachment.mediaType,
      path: filePath,
    });
  }

  const lines = files.map((file, index) => `${index + 1}. ${file.name}: ${file.path} (${file.mediaType})`);
  return [
    'Virtual Office uploaded image attachments are also available as local file paths for tools:',
    ...lines,
    '',
    'Use these paths only when a tool or skill requires a local image path. The images are already attached inline for visual understanding.',
  ].join('\n');
}

function moxxyHome(): string {
  const configured = process.env.MOXXY_HOME?.trim();
  return configured ? configured : path.join(homedir(), '.moxxy');
}

function attachmentFilename(attachment: ImagePromptAttachment, index: number): string {
  const base = safeAttachmentBaseName(attachment.name, index);
  return `${String(index + 1).padStart(2, '0')}-${randomUUID()}-${base}${extensionForMediaType(attachment.mediaType)}`;
}

function safeAttachmentBaseName(name: string | undefined, index: number): string {
  const fallback = `image-${index + 1}`;
  const parsed = path.parse(path.basename(name ?? fallback)).name || fallback;
  const safe = parsed
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return safe || fallback;
}

function safeAttachmentDisplayName(name: string | undefined, fallback: string): string {
  const normalized = (name ?? fallback).replace(/\\/g, '/');
  return path.basename(normalized) || fallback;
}

function extensionForMediaType(mediaType: string): string {
  switch (mediaType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/png':
    default:
      return '.png';
  }
}

interface SessionHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  content: string;
  run_id: string | null;
  timestamp: number;
  created_at: string;
  attachments?: ReadonlyArray<UserPromptAttachment>;
}

function historyFromSessionLog(session: ClientSession, limit: number): { messages: SessionHistoryMessage[] } {
  const messages: SessionHistoryMessage[] = [];
  for (const event of session.log.toJSON()) {
    if (event.type === 'user_prompt') {
      messages.push({
        id: String(event.id),
        role: 'user',
        text: event.text,
        content: event.text,
        run_id: String(event.turnId),
        timestamp: event.ts,
        created_at: new Date(event.ts).toISOString(),
        ...(event.attachments && event.attachments.length > 0 ? { attachments: event.attachments } : {}),
      });
      continue;
    }
    if (event.type === 'assistant_message') {
      messages.push({
        id: String(event.id),
        role: 'assistant',
        text: event.content,
        content: event.content,
        run_id: String(event.turnId),
        timestamp: event.ts,
        created_at: new Date(event.ts).toISOString(),
      });
    }
  }
  return { messages: messages.filter((message) => message.text.trim().length > 0).slice(-limit) };
}
