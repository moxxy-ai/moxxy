/**
 * Test double for `@/lib/tauri`. Tests opt in per-file via:
 *
 *   vi.mock('@/lib/tauri', () => import('@/__mocks__/tauri'));
 */

import { vi } from 'vitest';

type Handler = (payload: unknown) => void;
type ResponseProducer = (args?: Record<string, unknown>) => unknown;

interface CallLog {
  readonly cmd: string;
  readonly args: Record<string, unknown> | undefined;
}

class MockTauri {
  private readonly responses = new Map<string, ResponseProducer>();
  private readonly listeners = new Map<string, Set<Handler>>();
  public readonly calls: CallLog[] = [];

  public respond(cmd: string, producer: ResponseProducer): void {
    this.responses.set(cmd, producer);
  }

  public emit<T>(event: string, payload: T): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const h of set) h(payload);
  }

  public reset(): void {
    this.responses.clear();
    this.listeners.clear();
    this.calls.length = 0;
  }

  public async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    this.calls.push({ cmd, args });
    const producer = this.responses.get(cmd);
    if (!producer) throw new Error(`mock-tauri: unmocked command '${cmd}'`);
    return producer(args) as T;
  }

  public async subscribe<T>(
    event: string,
    handler: (payload: T) => void,
  ): Promise<() => void> {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const h: Handler = (p) => handler(p as T);
    set.add(h);
    return () => {
      set?.delete(h);
    };
  }
}

export const mockTauri = new MockTauri();

export const invoke = vi.fn(<T,>(cmd: string, args?: Record<string, unknown>) =>
  mockTauri.invoke<T>(cmd, args),
);

export const subscribe = vi.fn(
  <T,>(event: string, handler: (payload: T) => void) =>
    mockTauri.subscribe<T>(event, handler),
);
