import { style } from './focus-styles';
import { FocusMarkdown } from './FocusMarkdown';
import type { FocusAskPrompt, FocusAskTone } from './useFocusAsk';

export function FocusAskCard({
  prompt,
  variant,
}: {
  readonly prompt: FocusAskPrompt;
  readonly variant: 'toast' | 'panel';
}): JSX.Element {
  return (
    <section
      role="group"
      aria-label={prompt.title}
      aria-live="polite"
      style={{
        ...style.focusAskCard,
        ...(variant === 'panel' ? style.focusAskCardPanel : style.focusAskCardToast),
      }}
    >
      <div style={style.focusAskTopline}>
        <span style={style.focusAskKicker}>{prompt.kicker}</span>
        <span style={style.focusAskDot} aria-hidden />
      </div>
      <h2 style={style.focusAskTitle}>{prompt.title}</h2>
      <FocusMarkdown text={prompt.body} style={style.focusAskBody} />
      {prompt.detail ? <pre style={style.focusAskDetail}>{prompt.detail}</pre> : null}
      {prompt.textInput ? (
        <textarea
          aria-label={prompt.textInput.label}
          value={prompt.textInput.value}
          placeholder={prompt.textInput.placeholder}
          onChange={(event) => prompt.textInput?.onChange(event.target.value)}
          rows={variant === 'panel' ? 3 : 2}
          style={style.focusAskTextArea}
        />
      ) : null}
      <div style={style.focusAskActions}>
        {prompt.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            title={action.title}
            disabled={action.disabled}
            onClick={action.onClick}
            style={{
              ...style.focusAskButton,
              ...buttonToneStyle(action.tone),
              ...(action.disabled ? style.focusAskButtonDisabled : null),
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function buttonToneStyle(tone: FocusAskTone): React.CSSProperties {
  if (tone === 'danger') return style.focusAskButtonDanger;
  if (tone === 'primary') return style.focusAskButtonPrimary;
  return style.focusAskButtonNeutral;
}
