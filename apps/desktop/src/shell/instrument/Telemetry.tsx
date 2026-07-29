import { useState } from 'react';
import { Modal } from '@moxxy/desktop-ui';
import { useContextUsage } from '@moxxy/client-core';
import type { SessionInfo } from '../../chat/agent-picker/types';
import { ProviderModelGrid } from '../../chat/agent-picker/ProviderModelGrid';
import { UsagePanel } from '../../chat/composer/UsagePanel';
import { ContextMeter, contextLevel } from './ContextMeter';

/**
 * The run's telemetry, in the instrument bar.
 *
 * These numbers used to live as chips inside the composer, behind a click: the
 * model name with a hair-thin bar under it, and everything else inside a modal.
 * That is backwards for the thing this app is for. During a forty-minute
 * unattended run the context window and the token count are the only numbers
 * that matter, and they are the reason you would intervene at all — so they are
 * permanent chrome now, next to the run's identity and its state.
 *
 * What is NOT here: spend and elapsed. Neither exists in the client today (there
 * is no pricing table and no turn-start timestamp), and inventing a plausible
 * number for a cost readout is worse than omitting it. They get cells when the
 * data does.
 *
 * The cluster is still the way into the model picker and the full usage
 * breakdown — it is quiet status that happens to be clickable, exactly as the
 * composer control was.
 *
 * Every cell is ONE line, matching the crumbs beside them: a 44px bar with
 * stacked label-over-value in it reads as two crowded rows rather than one
 * instrument. The context percentage is deliberately not always painted — the
 * ticks already give the magnitude at a glance, the exact number is a hover away,
 * and it surfaces on its own once it crosses into caution, which is the point at
 * which the number becomes something you would act on.
 *
 * Cells drop by PRIORITY as the bar narrows (see the container queries in
 * styles.css), rather than the bar scrolling: chrome that scrolls can put a
 * control out of reach, which is worse than showing less of it.
 */
export function Telemetry({
  workspaceId,
  info,
  selectedModel,
  disabled,
  onPick,
}: {
  readonly workspaceId: string;
  readonly info: SessionInfo;
  readonly selectedModel: string | null;
  readonly disabled: boolean;
  readonly onPick: (provider: string, model: string | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const usage = useContextUsage(workspaceId);
  // Model name only: the override when set, else the active provider (whose
  // runner-default model is not named until the first response).
  const model = selectedModel ?? info.activeProvider ?? 'model';
  const mode = info.activeMode ?? null;
  const fraction = usage.fraction;
  const prompt = usage.summary.totalPrompt;
  const output = usage.summary.totalOutput;

  return (
    <>
      <button
        type="button"
        className="tele"
        data-testid="instrument-telemetry"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={
          fraction != null
            ? `Context ${Math.round(fraction * 100)}% used, model ${model} — open model and usage`
            : `Model ${model} — open model and usage`
        }
      >
        {fraction != null && (
          <span
            className="tele__cell tip"
            data-cell="context"
            data-level={contextLevel(fraction)}
            data-tip-side="bottom"
            data-tip={contextTip(fraction, usage.contextTokens, usage.contextWindow)}
          >
            {/* No label either: a segmented gauge is self-evidently a gauge, and
                the hover carries what it measures. The meter itself keeps an
                aria-label, so a screen reader is never left with bare ticks. */}
            <ContextMeter fraction={fraction} />
            {/* Painted only once it matters. Below caution the ticks say enough. */}
            {contextLevel(fraction) !== 'nominal' && (
              <span className="tele__v">{Math.round(fraction * 100)}%</span>
            )}
          </span>
        )}
        {usage.hasData && (
          <span
            className="tele__cell tip"
            data-cell="tokens"
            data-tip-side="bottom"
            data-tip={`${(prompt + output).toLocaleString()} tokens over ${usage.summary.calls} calls`}
          >
            <span className="tele__k">tok</span>
            <span className="tele__v">{compact(prompt + output)}</span>
          </span>
        )}
        {/* No label. A model name says what it is; `agent openai-codex` spends a
            word on something the value already tells you. The numeric cells keep
            theirs because `12.4k` on its own does not. */}
        <span className="tele__cell" data-cell="agent">
          <span className="tele__v tele__v--text">
            {model}
            {mode && <small> · {mode}</small>}
          </span>
        </span>
      </button>
      {open && (
        <Modal title="Model & usage" width={620} onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 'var(--type-label)',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-dim)',
                }}
              >
                Model
              </h3>
              <ProviderModelGrid
                providers={info.providers}
                activeProvider={info.activeProvider}
                activeModel={selectedModel}
                onPick={(p, m) => {
                  onPick(p, m);
                  setOpen(false);
                }}
              />
            </section>
            <UsagePanel usage={usage} workspaceId={workspaceId} />
          </div>
        </Modal>
      )}
    </>
  );
}

/** The precise reading, for the hover. The ticks are the glanceable form; this
 *  is what you check when the ticks made you look. */
function contextTip(
  fraction: number,
  used: number | null,
  window: number | null,
): string {
  const pct = `${Math.round(fraction * 100)}% of the context window`;
  if (used == null || window == null) return pct;
  return `${pct} · ${used.toLocaleString()} / ${window.toLocaleString()} tokens`;
}

/**
 * Token counts in an instrument cell. A run reaches six and seven figures, and
 * `1234567` in a 12px cell is a smear — so it reads as `1.2M`, with one decimal
 * only where that decimal carries information.
 */
export function compact(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    return `${k < 100 ? k.toFixed(1) : Math.round(k)}k`;
  }
  return `${(n / 1_000_000).toFixed(1)}M`;
}
