/**
 * The installer screen: the whole window, while Moxxy updates or sets itself
 * up after an update. It draws the model it is given — the steps and how far
 * they are, one bar, and a button only when a person has something to decide.
 */

import { useId, type AnimationEvent, type CSSProperties } from 'react';
import { Button } from '@moxxy/desktop-ui';
import { MoxxyMark } from '@/components/MoxxyMark';
import type { UpdateScreenModel, UpdateScreenStep } from './update-screen-model';

export interface UpdateScreenProps {
  readonly model: UpdateScreenModel;
  /** The screen is on its way out; `onExited` fires when its exit has played. */
  readonly leaving: boolean;
  readonly onExited: () => void;
  readonly onRetry: () => void;
  /** Opens the page the installer can be downloaded from. */
  readonly onManual: () => void;
  readonly onClose: () => void;
}

function StepGlyph(): JSX.Element {
  return (
    <span className="update-step__glyph" aria-hidden="true">
      <span className="update-step__ring" />
      <span className="update-step__spinner" />
      <svg className="update-step__check" viewBox="0 0 16 16">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
      <svg className="update-step__cross" viewBox="0 0 16 16">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
      </svg>
    </span>
  );
}

function StepRow({ step, index }: { readonly step: UpdateScreenStep; readonly index: number }): JSX.Element {
  const failed = step.status === 'failed';
  return (
    <li
      className="update-step"
      data-status={step.status}
      aria-current={step.status === 'running' ? 'step' : undefined}
      style={{ '--i': index } as CSSProperties}
    >
      <StepGlyph />
      <span className="update-step__label">{step.label}</span>
      {step.detail && !failed && <span className="update-step__detail mono">{step.detail}</span>}
      {step.detail && failed && <span className="update-step__error">{step.detail}</span>}
    </li>
  );
}

function ProgressBar({ value }: { readonly value: number | null }): JSX.Element {
  return (
    <div
      className="update-progress"
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(value === null ? { 'data-indeterminate': 'true' } : { 'aria-valuenow': Math.round(value * 100) })}
    >
      <div className="update-progress__fill" style={value === null ? undefined : { transform: `scaleX(${value})` }} />
    </div>
  );
}

export function UpdateScreen({ model, leaving, onExited, onRetry, onManual, onClose }: UpdateScreenProps): JSX.Element {
  const titleId = useId();
  const exited = (event: AnimationEvent<HTMLDivElement>): void => {
    if (leaving && event.target === event.currentTarget) onExited();
  };
  const closeLabel = model.kind === 'failed' ? 'Not now' : 'Open Moxxy';
  return (
    <div
      className="update-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-kind={model.kind}
      data-leaving={leaving ? 'true' : undefined}
      onAnimationEnd={exited}
    >
      <div className="update-screen__panel">
        <MoxxyMark size={56} className={model.busy ? 'moxxy-avatar-loader' : undefined} />
        <div className="update-screen__heading">
          <h1 id={titleId} className="update-screen__title">
            {model.title}
          </h1>
          <p className="update-screen__subtitle">{model.subtitle}</p>
        </div>

        <ol className="update-steps" aria-live="polite">
          {model.steps.map((step, index) => (
            <StepRow key={step.key} step={step} index={index} />
          ))}
        </ol>

        {model.busy && <ProgressBar value={model.progress} />}

        {model.notes.length > 0 && (
          <ul className="update-notes">
            {model.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}

        {model.actions.length > 0 && (
          <div className="update-screen__actions">
            {model.actions.includes('close') && (
              <Button variant={model.actions.includes('retry') ? 'secondary' : 'cta'} size="lg" autoFocus={!model.actions.includes('retry')} onClick={onClose}>
                {closeLabel}
              </Button>
            )}
            {model.actions.includes('manual') && (
              <Button variant="secondary" size="lg" onClick={onManual}>
                Download the installer
              </Button>
            )}
            {model.actions.includes('retry') && (
              <Button variant="cta" size="lg" autoFocus onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
        )}

        {model.footer && <p className="update-screen__footer">{model.footer}</p>}
      </div>
    </div>
  );
}
