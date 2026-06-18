import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  type LLMProvider,
  type ModelDescriptor,
  type ProviderEvent,
  type ProviderRequest,
  writeFileAtomic,
} from '@moxxy/sdk';
import { hashRequest } from './hash.js';

export type FixtureMode = 'replay' | 'record' | 'passthrough';

export function fixtureMode(env: NodeJS.ProcessEnv = process.env): FixtureMode {
  const raw = (env.MOXXY_FIXTURES ?? 'replay').toLowerCase();
  if (raw === 'record' || raw === 'replay' || raw === 'passthrough') return raw;
  return 'replay';
}

interface Fixture {
  readonly hash: string;
  readonly request: ProviderRequest;
  readonly events: ReadonlyArray<ProviderEvent>;
  readonly recordedAt: string;
}

export interface RecordedProviderOptions {
  readonly mode?: FixtureMode;
  readonly fixtureDir: string;
  readonly upstream?: LLMProvider;
  readonly testName?: string;
}

export class RecordedProvider implements LLMProvider {
  readonly name: string;
  readonly models: ReadonlyArray<ModelDescriptor>;
  private readonly mode: FixtureMode;
  private readonly fixtureDir: string;
  private readonly upstream?: LLMProvider;
  private readonly testName: string;

  constructor(opts: RecordedProviderOptions) {
    this.name = opts.upstream?.name ?? 'recorded';
    this.models = opts.upstream?.models ?? [];
    this.mode = opts.mode ?? fixtureMode();
    this.fixtureDir = opts.fixtureDir;
    this.upstream = opts.upstream;
    this.testName = opts.testName ?? 'default';
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const hash = hashRequest(req);
    if (this.mode === 'passthrough') {
      if (!this.upstream) throw new Error('passthrough mode requires upstream provider');
      yield* this.upstream.stream(req);
      return;
    }
    if (this.mode === 'replay') {
      const fixture = await this.readFixture(hash);
      if (!fixture) {
        throw new Error(
          `RecordedProvider: no fixture for hash ${hash} (test='${this.testName}'). ` +
            `Re-run with MOXXY_FIXTURES=record to capture.`,
        );
      }
      for (const event of fixture.events) yield event;
      return;
    }
    // record
    if (!this.upstream) throw new Error('record mode requires upstream provider');
    const events: ProviderEvent[] = [];
    for await (const event of this.upstream.stream(req)) {
      events.push(event);
      yield event;
    }
    await this.writeFixture({
      hash,
      request: req,
      events,
      recordedAt: new Date().toISOString(),
    });
  }

  async countTokens(req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>): Promise<number> {
    if (this.upstream) return this.upstream.countTokens(req);
    return 0;
  }

  private fixturePath(hash: string): string {
    return path.join(this.fixtureDir, `${this.testName}.${hash}.json`);
  }

  private async readFixture(hash: string): Promise<Fixture | null> {
    try {
      const raw = await fs.readFile(this.fixturePath(hash), 'utf8');
      return JSON.parse(raw) as Fixture;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  private async writeFixture(fixture: Fixture): Promise<void> {
    // Atomic write (tmp + rename, per repo invariant 5) so an interrupted
    // record run (Ctrl-C mid-write) can never leave a torn fixture that then
    // fails JSON.parse on the next replay. writeFileAtomic mkdir's the dir.
    await writeFileAtomic(this.fixturePath(fixture.hash), JSON.stringify(fixture, null, 2));
  }
}

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e;
}
