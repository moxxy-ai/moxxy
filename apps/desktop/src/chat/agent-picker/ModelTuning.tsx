/**
 * Reasoning effort and fast mode for the model in use, under the model grid.
 * Presentational: the values and the switches come from `useModelTuning`.
 */

import { Select } from '@moxxy/desktop-ui';
import { Switch } from '../../settings/settings-primitives';
import type { EffortLevel, ModelTuning as Tuning } from './useModelTuning';

const EFFORT_LABELS: Record<EffortLevel, string> = {
  off: 'Off',
  default: 'Default',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
};

export function ModelTuning({ tuning }: { readonly tuning: Tuning }): JSX.Element | null {
  if (!tuning.canSetEffort && !tuning.canSetFast) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {tuning.canSetEffort && (
          <label style={rowStyle}>
            <span style={labelStyle}>Effort</span>
            <Select
              aria-label="Reasoning effort"
              tone="soft"
              value={tuning.effort}
              disabled={tuning.busy}
              onChange={(e) => void tuning.setEffort(e.target.value as EffortLevel)}
              data-testid="model-effort-select"
            >
              {tuning.effortLevels.map((level) => (
                <option key={level} value={level}>
                  {EFFORT_LABELS[level]}
                </option>
              ))}
            </Select>
          </label>
        )}
        {tuning.canSetFast && (
          <div style={rowStyle} title="About 1.5× faster answers; uses 2–2.5× more of your plan or credits">
            <span style={labelStyle}>Fast</span>
            <Switch
              on={tuning.fast}
              label="Fast mode"
              disabled={tuning.busy}
              busy={tuning.busy}
              onClick={() => void tuning.setFast(!tuning.fast)}
            />
          </div>
        )}
      </div>
      {tuning.error && (
        <p role="alert" style={{ margin: 0, fontSize: 'var(--type-meta)', color: 'var(--color-red)' }}>
          {tuning.error}
        </p>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--type-meta)',
  fontWeight: 700,
  color: 'var(--color-text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};
