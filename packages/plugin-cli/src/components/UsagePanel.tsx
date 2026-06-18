import React from 'react';
import { Box, Text } from 'ink';
import {
  summarizeSessionTokensFromEvents,
  summarizeTokensByModel,
  addModelTotals,
  type ModelUsageTotals,
  type MoxxyEvent,
} from '@moxxy/sdk';
import { loadUsageStats, type UsageStatsFile } from '@moxxy/core';
import { Colors } from '../theme.js';
import { Modal, type ModalTab } from './Modal.js';

export interface UsagePanelProps {
  readonly events: ReadonlyArray<MoxxyEvent>;
  /** Active model's context window, for the live context-fill bar. */
  readonly contextWindow?: number | null;
  /** Current estimated context tokens (what the next call would send). */
  readonly contextTokens?: number | null;
  readonly onClose?: () => void;
}

const BAR_WIDTH = 22;
const LABEL_COL = 14;
const SPARKS = '▁▂▃▄▅▆▇█';

function clamp(f: number): number {
  return Math.max(0, Math.min(1, f));
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function pct(f: number): string {
  return `${Math.round(f * 100)}%`;
}

/**
 * A bar where only the FILLED portion carries the accent color and the empty
 * track is dim — so a 0% bar reads as empty, not as a solid colored block
 * (the original bug where a 0% "cache read" bar looked full).
 */
const Bar: React.FC<{ frac: number; color?: string; width?: number }> = ({
  frac,
  color,
  width = BAR_WIDTH,
}) => {
  const filled = Math.round(clamp(frac) * width);
  return (
    <Text>
      <Text {...(color ? { color } : {})}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(width - filled)}</Text>
    </Text>
  );
};

/** One row of the prompt-composition breakdown: label · bar · % · value. */
const CompRow: React.FC<{ label: string; frac: number; value: number; color?: string }> = ({
  label,
  frac,
  value,
  color,
}) => (
  <Box>
    <Box width={LABEL_COL}>
      <Text dimColor>{label}</Text>
    </Box>
    <Bar frac={frac} color={color} />
    <Text>{`  ${pct(frac).padStart(4)}`}</Text>
    <Text dimColor>{`  ${fmt(value)}`}</Text>
  </Box>
);

/** A labelled metric bar (cache hit, context fill). */
const MetricRow: React.FC<{
  label: string;
  frac: number;
  color?: string;
  suffix?: string;
}> = ({ label, frac, color, suffix }) => (
  <Box>
    <Box width={LABEL_COL}>
      <Text bold>{label}</Text>
    </Box>
    <Bar frac={frac} color={color} />
    <Text>{`  ${pct(frac).padStart(4)}`}</Text>
    {suffix ? <Text dimColor>{`  ${suffix}`}</Text> : null}
  </Box>
);

const MODEL_COL = 26;

/** One row of the lifetime per-model breakdown: model · calls · prompt · output. */
const ModelRow: React.FC<{
  name: string;
  calls: number;
  prompt: number;
  output: number;
  dim?: boolean;
}> = ({ name, calls, prompt, output, dim }) => {
  const label = name.length > MODEL_COL - 1 ? `${name.slice(0, MODEL_COL - 2)}…` : name;
  return (
    <Box>
      <Box width={MODEL_COL}>
        <Text dimColor={dim}>{label}</Text>
      </Box>
      <Text dimColor>
        {`${String(calls).padStart(4)} calls   ${fmt(prompt).padStart(7)} prompt   ${fmt(output).padStart(6)} out`}
      </Text>
    </Box>
  );
};

/**
 * Per-model rows (one per provider/model), sorted by prompt volume. Merges the
 * persisted cross-session aggregate with THIS session's live usage so the
 * breakdown shows up immediately — the persisted file only gains the current
 * session on close, so without the live merge a fresh install reads empty.
 */
function modelBreakdownRows(
  file: UsageStatsFile | null,
  liveByModel: Record<string, ModelUsageTotals>,
): Array<{ name: string; calls: number; prompt: number; output: number }> {
  const merged: Record<string, ModelUsageTotals> = {};
  const add = (key: string, t: ModelUsageTotals): void => {
    merged[key] = merged[key] ? addModelTotals(merged[key]!, t) : t;
  };
  for (const [name, m] of Object.entries(file?.models ?? {})) add(name, m);
  for (const [name, m] of Object.entries(liveByModel)) add(name, m);
  return Object.entries(merged)
    .map(([name, m]) => ({
      name,
      calls: m.calls,
      prompt: m.inputTokens + m.cacheReadTokens + m.cacheCreationTokens,
      output: m.outputTokens,
    }))
    .sort((a, b) => b.prompt - a.prompt);
}

/**
 * Max of a numeric series without spreading it as call arguments. The series
 * grows one entry per provider response with no cap (see {@link perCallPrompt}),
 * so `Math.max(...series)` blows the JS engine argument limit and RangeErrors in
 * long sessions — a reduce is O(n) and unbounded-safe.
 */
export function peak(series: ReadonlyArray<number>, seed = 0): number {
  let m = seed;
  for (const v of series) if (v > m) m = v;
  return m;
}

/** Per-call prompt sizes (input + cache read + cache write) in call order. */
function perCallPrompt(events: ReadonlyArray<MoxxyEvent>): number[] {
  const out: number[] = [];
  for (const e of events) {
    if (e.type !== 'provider_response') continue;
    if (
      e.inputTokens === undefined &&
      e.cacheReadTokens === undefined &&
      e.cacheCreationTokens === undefined
    ) {
      continue;
    }
    out.push((e.inputTokens ?? 0) + (e.cacheReadTokens ?? 0) + (e.cacheCreationTokens ?? 0));
  }
  return out;
}

/** Render a sparkline of per-call prompt sizes, scaled to the series max. */
function sparkline(series: number[], maxCols = 48): string {
  if (series.length === 0) return '';
  const tail = series.slice(-maxCols);
  const max = Math.max(...tail, 1);
  return tail
    .map((v) => SPARKS[Math.min(SPARKS.length - 1, Math.round((v / max) * (SPARKS.length - 1)))])
    .join('');
}

/**
 * `/usage` modal — cumulative session token accounting. Bars show prompt
 * composition (cache read vs fresh vs cache write), cache hit rate, input-cost
 * savings, live context fill, and a per-call sparkline that makes growth
 * (quadratic) vs bounded (flat) visible at a glance. Esc closes (global Esc is
 * suppressed while an overlay is open, so we capture it here).
 */
type TabId = 'session' | 'lifetime';

export const UsagePanel: React.FC<UsagePanelProps> = ({
  events,
  contextWindow,
  contextTokens,
  onClose,
}) => {
  const s = React.useMemo(() => summarizeSessionTokensFromEvents(events), [events]);
  const series = React.useMemo(() => perCallPrompt(events), [events]);

  // Cross-session aggregate (~/.moxxy/usage.json) loaded async; `null` = still
  // reading. Merged with THIS session's live per-model usage so the breakdown
  // is visible immediately (the file only gains the current session on close).
  const [lifetime, setLifetime] = React.useState<UsageStatsFile | null>(null);
  React.useEffect(() => {
    let alive = true;
    void loadUsageStats().then((f) => {
      if (alive) setLifetime(f);
    });
    return () => {
      alive = false;
    };
  }, []);
  const liveByModel = React.useMemo(() => summarizeTokensByModel(events), [events]);
  const lifeRows = React.useMemo(
    () => modelBreakdownRows(lifetime, liveByModel),
    [lifetime, liveByModel],
  );
  const hasModels = lifeRows.length > 0;
  const lifeTotal = React.useMemo(
    () =>
      lifeRows.reduce(
        (acc, r) => ({
          calls: acc.calls + r.calls,
          prompt: acc.prompt + r.prompt,
          output: acc.output + r.output,
        }),
        { calls: 0, prompt: 0, output: 0 },
      ),
    [lifeRows],
  );

  const hasSession = s.calls > 0;
  const [activeTab, setActiveTab] = React.useState<TabId>(hasSession ? 'session' : 'lifetime');

  if (!hasSession && !hasModels) {
    const loading = lifetime === null;
    return (
      <Modal
        title="Usage"
        subtitle={loading ? 'loading…' : 'no usage recorded yet'}
        {...(onClose ? { onClose } : {})}
      >
        <Text dimColor>
          {loading
            ? '(reading saved usage…)'
            : '(no token usage yet — run a turn, then reopen /usage)'}
        </Text>
      </Modal>
    );
  }

  const tabs: ModalTab[] | undefined = hasSession && hasModels
    ? [
        { id: 'session', label: 'This session' },
        { id: 'lifetime', label: 'Lifetime' },
      ]
    : undefined;

  const freshFrac = s.totalPrompt > 0 ? s.totalInput / s.totalPrompt : 0;
  const readFrac = s.totalPrompt > 0 ? s.totalCacheRead / s.totalPrompt : 0;
  const writeFrac = s.totalPrompt > 0 ? s.totalCacheCreation / s.totalPrompt : 0;

  const ctxFrac =
    contextWindow && contextTokens != null && contextWindow > 0
      ? contextTokens / contextWindow
      : null;
  const ctxColor =
    ctxFrac == null ? undefined : ctxFrac >= 0.85 ? Colors.danger : ctxFrac >= 0.6 ? Colors.busy : Colors.active;

  const saved = s.savedRatio;
  const trend =
    series.length >= 4 ? (series[series.length - 1]! > series[0]! * 1.5 ? 'growing' : 'bounded') : null;

  const subtitle = hasSession
    ? `${s.calls} calls   ·   ${fmt(s.totalPrompt)} prompt   ·   ${fmt(s.totalOutput)} output`
    : 'saved across sessions';

  // Decide which sections to render. With tabs active, only one is on
  // screen at a time; without tabs (single-source data), keep the old
  // stacked layout.
  const showSession = hasSession && (!tabs || activeTab === 'session');
  const showLifetime = hasModels && (!tabs || activeTab === 'lifetime');

  return (
    <Modal
      title="Usage"
      subtitle={subtitle}
      {...(tabs ? { tabs, activeTabId: activeTab, onTabChange: (id) => setActiveTab(id as TabId) } : {})}
      {...(onClose ? { onClose } : {})}
    >
      {showSession ? (
        <>
          <Text bold>Prompt composition</Text>
          <CompRow label="cache read" frac={readFrac} value={s.totalCacheRead} color={Colors.active} />
          <CompRow label="fresh input" frac={freshFrac} value={s.totalInput} />
          <CompRow label="cache write" frac={writeFrac} value={s.totalCacheCreation} color={Colors.busy} />

          <Box marginTop={1} flexDirection="column">
            <MetricRow
              label="Cache hit"
              frac={s.cacheHitRate}
              color={s.cacheHitRate >= 0.5 ? Colors.active : Colors.busy}
            />
            {ctxFrac != null ? (
              <MetricRow
                label="Context fill"
                frac={ctxFrac}
                color={ctxColor}
                suffix={`${fmt(contextTokens ?? 0)} / ${fmt(contextWindow ?? 0)}`}
              />
            ) : null}
          </Box>

          <Box marginTop={1}>
            <Box width={LABEL_COL}>
              <Text bold>Input cost</Text>
            </Box>
            <Text>{fmt(s.billedInputEq)} billed-eq</Text>
            {saved > 0.005 ? (
              <Text color={Colors.active} bold>{`   saved ${pct(saved)}`}</Text>
            ) : (
              <Text dimColor>{'   no cache savings yet'}</Text>
            )}
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text bold>Per-call prompt </Text>
              <Text dimColor>{`peak ${fmt(peak(series))}`}</Text>
            </Box>
            <Box>
              <Text>{sparkline(series)}</Text>
              {trend ? (
                <Text color={trend === 'growing' ? Colors.busy : Colors.active}>
                  {trend === 'growing' ? '  ↑ growing' : '  ≈ bounded'}
                </Text>
              ) : null}
            </Box>
          </Box>

          {!s.cacheEffective ? (
            <Box marginTop={1}>
              <Text color={Colors.danger}>
                {'⚠ cache ineffective — writing cache but not reading it back (prefix likely unstable)'}
              </Text>
            </Box>
          ) : null}
        </>
      ) : null}

      {showLifetime ? (
        <Box marginTop={showSession ? 1 : 0} flexDirection="column">
          <Box>
            <Text bold>By model </Text>
            <Text dimColor>{`(saved + this session · ${lifeRows.length} model${lifeRows.length === 1 ? '' : 's'})`}</Text>
          </Box>
          {lifeRows.slice(0, 8).map((r) => (
            <ModelRow key={r.name} name={r.name} calls={r.calls} prompt={r.prompt} output={r.output} />
          ))}
          {lifeRows.length > 1 ? (
            <ModelRow name="total" calls={lifeTotal.calls} prompt={lifeTotal.prompt} output={lifeTotal.output} dim />
          ) : null}
          <Text dimColor>{'  /usage clear resets saved history'}</Text>
        </Box>
      ) : null}
    </Modal>
  );
};
