/**
 * Text field primitives — the one card-input shape the desktop uses, plus a
 * matching multi-line `TextArea`. `tone='soft'` is the recessed
 * `var(--color-input-soft)` fill some
 * modals use; `mono` switches to the monospace token (skill filenames, command
 * args). `style`/`className` merge last for per-site tweaks (width, min-height).
 */
import type { CSSProperties, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

export type FieldTone = 'plain' | 'soft';

/* The field is the input half of the same control the buttons draw: one height,
 * one radius, one size. It used to be 9px/14px/radius-10 — a consumer form field
 * that towered over every button beside it and rounded off the instrument. */
const fieldStyle = (tone: FieldTone, mono: boolean): CSSProperties => ({
  height: 'var(--frame-row)',
  padding: '0 var(--space-8)',
  fontSize: 'var(--type-row)',
  color: 'var(--color-text)',
  background: tone === 'soft' ? 'var(--color-input-soft)' : 'var(--color-surface)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 'var(--radius-chip)',
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
        height: 'auto',
        padding: 'var(--space-6) var(--space-8)',
        lineHeight: 1.5,
        resize: 'vertical',
        // Plain textareas inherit the UI font; mono keeps the field's mono token.
        ...(mono ? {} : { fontFamily: 'inherit' }),
        ...style,
      }}
      {...rest}
    />
  );
}
