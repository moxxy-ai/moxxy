import type { EmittedEvent, LoopContext, MoxxyEvent } from '@moxxy/sdk';
import type { Session } from './session.js';

export interface RunTurnOptions {
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly maxIterations?: number;
}

export async function* runTurn(
  session: Session,
  prompt: string,
  opts: RunTurnOptions = {},
): AsyncIterable<MoxxyEvent> {
  const queue: MoxxyEvent[] = [];
  const waiters: Array<() => void> = [];
  let done = false;
  let strategyError: unknown = null;

  const wake = (): void => waiters.shift()?.();
  const unsubscribe = session.log.subscribe((event) => {
    queue.push(event);
    wake();
  });

  const { turnId } = session.startTurn();
  const provider = session.providers.getActive();
  const model = opts.model ?? provider.models[0]?.id ?? 'default';

  await session.log.append({
    type: 'user_prompt',
    sessionId: session.id,
    turnId,
    source: 'user',
    text: prompt,
  });

  const strategy = session.loops.getActive();
  const ctx: LoopContext = {
    sessionId: session.id,
    turnId,
    model,
    systemPrompt: opts.systemPrompt,
    provider,
    tools: session.tools,
    skills: session.skills,
    log: session.log,
    compactor: session.compactors.getActive(),
    permissions: session.resolver,
    hooks: session.dispatcher,
    pluginHost: session.pluginHost,
    signal: session.signal,
    maxIterations: opts.maxIterations,
    emit: (event: EmittedEvent) => session.log.append(event),
  };

  const turnStartCtx = { ...session.appContext(), turnId, iteration: 0 };

  const strategyPromise = (async () => {
    try {
      await session.dispatcher.dispatchTurnStart(turnStartCtx);
      for await (const _ of strategy.run(ctx)) {
        // Events are surfaced via the log subscription above.
        void _;
      }
      await session.dispatcher.dispatchTurnEnd(turnStartCtx);
    } catch (err) {
      strategyError = err;
    } finally {
      done = true;
      wake();
    }
  })();

  try {
    while (true) {
      while (queue.length > 0) yield queue.shift() as MoxxyEvent;
      if (done) break;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  } finally {
    unsubscribe();
    await strategyPromise;
  }

  if (strategyError) throw strategyError;
}

export async function collectTurn(
  session: Session,
  prompt: string,
  opts: RunTurnOptions = {},
): Promise<ReadonlyArray<MoxxyEvent>> {
  const events: MoxxyEvent[] = [];
  for await (const event of runTurn(session, prompt, opts)) events.push(event);
  return events;
}
