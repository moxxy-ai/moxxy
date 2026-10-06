import { z } from 'zod';

/** Per-frame byte ceiling shared by every native helper. */
export const MAX_FRAME_BYTES = 3_000_000;
const idSchema = z.string().min(1).max(160);

export const controlCommandSchema = z.enum(['pause', 'resume', 'stop', 'takeover']);
/** The first helper protocol that understands `takeover`; older helpers are paused instead. */
export const TAKEOVER_PROTOCOL_VERSION = 5;
export const controlStates = ['idle', 'background', 'foreground', 'waiting_for_focus', 'paused_by_user', 'recovering', 'stopped', 'failed'] as const;

/** A request-correlated state change; the transport suspends the request deadline while waiting. */
export const controlStateSchemaFor = (version: number) => z.object({
  version: z.literal(version), event: z.literal('control_state'), id: idSchema, state: z.enum(controlStates),
}).strict();
export type ControlState = z.infer<ReturnType<typeof controlStateSchemaFor>>;

export const responseSchemaFor = (version: number) => z.discriminatedUnion('ok', [
  z.object({ version: z.literal(version), id: idSchema, ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ version: z.literal(version), id: idSchema, ok: z.literal(false),
    error: z.object({ code: z.string().max(80), message: z.string().max(2048) }).strict() }).strict(),
]);

/** A byte-bounded decoder; UTF-8 is decoded only after a complete frame arrives. */
export class JsonLineDecoder {
  private pending = Buffer.alloc(0);
  constructor(private readonly limit: number) {}

  push(bytes: Buffer): unknown[] {
    const frames: unknown[] = [];
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      const part = bytes.subarray(offset, end);
      if (this.pending.length + part.length > this.limit) throw new Error('Computer Use protocol frame limit exceeded');
      this.pending = Buffer.concat([this.pending, part]);
      if (newline < 0) break;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(this.pending);
      frames.push(JSON.parse(text));
      this.pending = Buffer.alloc(0);
      offset = newline + 1;
    }
    return frames;
  }

  finish(): void {
    if (this.pending.length) throw new Error('Computer Use protocol incomplete frame');
  }
}
