import { useId, useState } from 'react';
import { Button, TextInput } from '@moxxy/desktop-ui';

export const DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 200_000;
const MAX_CONTEXT_WINDOW = 10_000_000;

export function CustomModelForm({
  provider,
  onCancel,
  onSubmit,
}: {
  readonly provider: string;
  readonly onCancel: () => void;
  readonly onSubmit: (model: string, contextWindow: number) => void;
}): JSX.Element {
  const id = useId();
  const [model, setModel] = useState('');
  const [knowsContextWindow, setKnowsContextWindow] = useState(false);
  const [contextWindowText, setContextWindowText] = useState('');
  const contextWindow = Number(contextWindowText);
  const validContextWindow = Number.isSafeInteger(contextWindow)
    && contextWindow > 0
    && contextWindow <= MAX_CONTEXT_WINDOW;
  const canSubmit = model.trim().length > 0
    && model.trim().length <= 256
    && (!knowsContextWindow || validContextWindow);

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(
      model.trim(),
      knowsContextWindow ? contextWindow : DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
    );
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 8 }}>
      <label htmlFor={`${id}-model`} style={formLabelStyle}>Custom model ID · {provider}</label>
      <TextInput
        id={`${id}-model`}
        aria-label="Custom model ID"
        value={model}
        onChange={(event) => setModel(event.target.value)}
        placeholder="vendor/model-id"
        maxLength={256}
        autoFocus
        style={inputStyle}
      />
      <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={formLabelStyle}>Context window</legend>
        <label style={choiceStyle}>
          <input
            type="radio"
            name={`${id}-context`}
            checked={!knowsContextWindow}
            onChange={() => setKnowsContextWindow(false)}
          />
          I don't know — use 200,000 tokens
        </label>
        <label style={choiceStyle}>
          <input
            type="radio"
            name={`${id}-context`}
            aria-label="I know the context window"
            checked={knowsContextWindow}
            onChange={() => setKnowsContextWindow(true)}
          />
          I know the context window
        </label>
        {knowsContextWindow && (
          <TextInput
            type="number"
            aria-label="Context window (tokens)"
            value={contextWindowText}
            onChange={(event) => setContextWindowText(event.target.value)}
            min={1}
            max={MAX_CONTEXT_WINDOW}
            step={1}
            placeholder="200000"
            style={inputStyle}
          />
        )}
      </fieldset>
      <p style={{ margin: 0, fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
        The model ID is sent unchanged to the selected provider. The context window controls when Moxxy compacts older conversation history.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="cta" disabled={!canSubmit}>Use custom model</Button>
      </div>
    </form>
  );
}

const formLabelStyle: React.CSSProperties = {
  fontSize: 'var(--type-meta)',
  color: 'var(--color-text)',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--color-card-border)',
  borderRadius: 'var(--radius-block)',
  background: 'var(--color-input-bg, var(--color-card-bg))',
  color: 'var(--color-text)',
};

const choiceStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--type-row)',
  color: 'var(--color-text-muted)',
};
