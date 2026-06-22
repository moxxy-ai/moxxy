import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  type LLMProvider,
  type ModelDescriptor,
  type ProviderEvent,
  type ProviderRequest,
} from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';
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
  // Absolute fixture paths this instance touched, de-duped in insertion order.
  // `written` = persisted in record mode; `read` = matched in replay mode.
  // Exposes which fixtures a run actually used so a consumer can report or prune
  // without resorting to a brittle directory mtime-diff (used by the fixture
  // recorder) — and so an external pruner can compute the orphaned set
  // (committed fixtures that no live run touches).
  private readonly _written = new Set<string>();
  private readonly _read = new Set<string>();

  constructor(opts: RecordedProviderOptions) {
    this.name = opts.upstream?.name ?? 'recorded';
    this.models = opts.upstream?.models ?? [];
    this.mode = opts.mode ?? fixtureMode();
    this.fixtureDir = opts.fixtureDir;
    this.upstream = opts.upstream;
    this.testName = opts.testName ?? 'default';
  }

  /** Fixture files this instance has written (record mode), in write order. */
  get writtenFixtures(): ReadonlyArray<string> {
    return [...this._written];
  }

  /** Fixture files this instance has read back (replay mode), in read order. */
  get readFixtures(): ReadonlyArray<string> {
    return [...this._read];
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
      this._read.add(this.fixturePath(hash));
      for (const event of fixture.events) yield event;
      return;
    }
    // record
    if (!this.upstream) throw new Error('record mode requires upstream provider');
    const events: ProviderEvent[] = [];
    try {
      for await (const event of this.upstream.stream(req)) {
        events.push(event);
        yield event;
      }
    } catch (err) {
      // A mid-stream upstream failure must NOT silently discard the partial
      // recording into a 'no fixture' on the next replay — surface it as a
      // record-mode failure (the fixture is intentionally not written so a
      // truncated capture can't masquerade as a complete one).
      throw new Error(
        `RecordedProvider: upstream stream failed mid-record after ${events.length} event(s) ` +
          `(test='${this.testName}', hash=${hash}); fixture NOT written: ` +
          `${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
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
    const file = this.fixturePath(hash);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return null;
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `RecordedProvider: unparseable fixture at ${file} (test='${this.testName}'): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // A syntactically valid but wrong-shaped fixture (hand-edited, partially
    // migrated, or an unrelated JSON file on the path) would otherwise throw a
    // cryptic 'events is not iterable' deep in stream(); fail with the path.
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as Partial<Fixture>).events)
    ) {
      throw new Error(
        `RecordedProvider: malformed fixture at ${file} (test='${this.testName}'): ` +
          `expected an object with an 'events' array.`,
      );
    }
    return parsed as Fixture;
  }

  private async writeFixture(fixture: Fixture): Promise<void> {
    // Atomic write (tmp + rename, per repo invariant 5) so an interrupted
    // record run (Ctrl-C mid-write) can never leave a torn fixture that then
    // fails JSON.parse on the next replay. writeFileAtomic mkdir's the dir.
    const file = this.fixturePath(fixture.hash);
    await writeFileAtomic(file, JSON.stringify(fixture, null, 2));
    this._written.add(file);
  }
}

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e;
}
