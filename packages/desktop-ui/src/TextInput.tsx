/**
 * Text field primitives — the one card-input shape the desktop uses, plus a
 * matching multi-line `TextArea`. `tone='soft'` is the `#f7f8fc` fill some
 * modals use; `mono` switches to the monospace token (skill filenames, command
 * args). `style`/`className` merge last for per-site tweaks (width, min-height).
 */
import type { CSSProperties, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

export type FieldTone = 'plain' | 'soft';

const fieldStyle = (tone: FieldTone, mono: boolean): CSSProperties => ({
  padding: '9px 12px',
  fontSize: 14,
  color: 'var(--color-text)',
  background: tone === 'soft' ? '#f7f8fc' : '#fff',
  border: '1px solid var(--color-card-border)',
  borderRadius: 10,
  outline: 'none',
  ...(mono ? { fontFamily: 'var(--font-mono)' } : {}),
});

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly tone?: FieldTone;
  readonly mono?: boolean;
}

export function TextInput({
  tone = 'plain',
  mono = false,
  style,
  type = 'text',
  ...rest
}: TextInputProps): JSX.Element {
  return <input type={type} style={{ ...fieldStyle(tone, mono), ...style }} {...rest} />;
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly tone?: FieldTone;
  readonly mono?: boolean;
}

export function TextArea({ tone = 'plain', mono = false, style, ...rest }: TextAreaProps): JSX.Element {
  return (
    <textarea
      style={{
        ...fieldStyle(tone, mono),
        resize: 'vertical',
        // Plain textareas inherit the UI font; mono keeps the field's mono token.
        ...(mono ? {} : { fontFamily: 'inherit' }),
        ...style,
      }}
      {...rest}
    />
  );
}
