import { forwardRef, useCallback, useRef, useState } from 'react';
import { assertDefined } from '@/lib/assert';
import { summarizeArgs, oneLine } from '@moxxy/chat-model';
import type { AskRequest, ApprovalRequest, ApprovalOption } from '@moxxy/desktop-ipc-contract';
import { Icon } from '@moxxy/desktop-ui';
import { askStore } from '@moxxy/client-core';
import { useFocusTrap } from './useFocusTrap';

/**
 * Bottom sheet rendered above the composer when the runner needs a decision —
 * a tool-call permission gate or a loop-strategy approval (research,
 * BMAD, …). The runner blocks on the answer, so this is modal-in-spirit: the
 * user picks an option and we reply over `ask.respond`, unblocking the turn.
 *
 * Operability is load-bearing here: focus is moved into the sheet on appear
 * (onto the safest default — Deny / the default option), Tab is trapped inside
 * it, Escape denies/cancels, and focus is restored to the opener on close.
 */
export function AskSheet({ ask }: { readonly ask: AskRequest }): JSX.Element {
  return ask.kind === 'workflow' && ask.workflow ? (
    <WorkflowSheet ask={ask} />
  ) : ask.kind === 'approval' && ask.approval ? (
    <ApprovalSheet ask={ask} approval={ask.approval} />
  ) : (
    <PermissionSheet ask={ask} />
  );
}

function WorkflowSheet({ ask }: { readonly ask: AskRequest }): JSX.Element {
  const workflow = ask.workflow;
  assertDefined(workflow, 'WorkflowSheet is only rendered for a workflow ask');
  const [reply, setReply] = useState('');
  const send = (): void => askStore.respond(ask.requestId, { text: reply.trim() });

  return (
    <Sheet icon="spark" title={`${workflow.workflow} is waiting`} accent="var(--color-amber)">
      <p style={bodyTextStyle}>
        <strong style={{ color: 'var(--color-text)' }}>{workflow.label}</strong>
        {workflow.stepId ? ` · ${workflow.stepId}` : ''}
      </p>
      {workflow.prompt.trim() && <pre style={preStyle}>{workflow.prompt.trim()}</pre>}
      <textarea
        autoFocus
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && reply.trim()) send();
        }}
        placeholder="Type your reply..."
        rows={3}
        style={{
          width: '100%',
          resize: 'vertical',
          padding: '10px 12px',
          fontSize: 13.5,
          lineHeight: 1.5,
          color: 'var(--color-text)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-card-border)',
          borderRadius: 10,
          outline: 'none',
          fontFamily: 'inherit',
        }}
      />
      <Buttons>
        <SheetButton tone="primary" onClick={send} disabled={reply.trim().length === 0}>
          Send reply
        </SheetButton>
      </Buttons>
    </Sheet>
  );
}

function PermissionSheet({ ask }: { readonly ask: AskRequest }): JSX.Element {
  const tool = ask.tool;
  const summary = tool ? oneLine(summarizeArgs(tool.input)) : '';
  const decide = (mode: 'deny' | 'allow_session' | 'allow_always'): void =>
    askStore.respond(ask.requestId, { mode });
  const denyRef = useRef<HTMLButtonElement>(null);
  // Escape => deny (the safe default for an unanswered permission gate).
  const onEscape = useCallback(
    () => askStore.respond(ask.requestId, { mode: 'deny' }),
    [ask.requestId],
  );
  return (
    <Sheet
      icon="wrench"
      title="Permission required"
      accent="var(--color-primary)"
      initialFocusRef={denyRef}
      onEscape={onEscape}
    >
      <p style={bodyTextStyle}>
        The agent wants to run <strong style={{ color: 'var(--color-text)' }}>{tool?.name}</strong>
        {tool?.description ? ` — ${tool.description}` : ''}.
      </p>
      {summary && <pre style={preStyle}>{summary}</pre>}
      <Buttons>
        <SheetButton ref={denyRef} tone="danger" onClick={() => decide('deny')}>
          Deny
        </SheetButton>
        <SheetButton tone="neutral" onClick={() => decide('allow_session')}>
          Allow
        </SheetButton>
        <SheetButton tone="primary" onClick={() => decide('allow_always')}>
          Always allow
        </SheetButton>
      </Buttons>
    </Sheet>
  );
}

function ApprovalSheet({
  ask,
  approval,
}: {
  readonly ask: AskRequest;
  readonly approval: ApprovalRequest;
}): JSX.Element {
  // When an option asks for follow-up text we switch to a small compose step.
  const [textOption, setTextOption] = useState<ApprovalOption | null>(null);
  const [text, setText] = useState('');
  const defaultRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const pick = (opt: ApprovalOption): void => {
    if (opt.requestsText) {
      setTextOption(opt);
      return;
    }
    askStore.respond(ask.requestId, { optionId: opt.id });
  };
  const sendText = (): void => {
    assertDefined(textOption, 'sendText is only reachable once a text option is selected');
    askStore.respond(ask.requestId, { optionId: textOption.id, text: text.trim() });
  };

  // Escape in the text sub-step backs out to the options; in the options view
  // it picks the default option only when that default is non-destructive (we
  // never auto-confirm a `danger` option from a keystroke, and never one that
  // would itself open a text sub-step).
  const onEscape = useCallback(() => {
    if (textOption) {
      setTextOption(null);
      return;
    }
    const def = approval.options.find((o) => o.id === approval.defaultOptionId);
    if (def && !def.danger && !def.requestsText) {
      askStore.respond(ask.requestId, { optionId: def.id });
    }
  }, [textOption, approval, ask.requestId]);

  const defaultOpt = approval.options.find((o) => o.id === approval.defaultOptionId);
  const initialFocusRef = textOption ? textRef : defaultOpt && !defaultOpt.danger ? defaultRef : undefined;

  return (
    <Sheet
      icon="spark"
      title={approval.title}
      accent="var(--color-primary)"
      initialFocusRef={initialFocusRef}
      onEscape={onEscape}
    >
      {approval.body.trim() && <pre style={preStyle}>{approval.body.trim()}</pre>}
      {textOption ? (
        <>
          <textarea
            ref={textRef}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={textOption.textPrompt ?? 'Add details…'}
            rows={3}
            style={{
              width: '100%',
              resize: 'vertical',
              padding: '10px 12px',
              fontSize: 13.5,
              lineHeight: 1.5,
              color: 'var(--color-text)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-card-border)',
              borderRadius: 10,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <Buttons>
            <SheetButton tone="neutral" onClick={() => setTextOption(null)}>
              Back
            </SheetButton>
            <SheetButton tone="primary" onClick={sendText} disabled={text.trim().length === 0}>
              {textOption.label}
            </SheetButton>
          </Buttons>
        </>
      ) : (
        <Buttons>
          {approval.options.map((opt) => (
            <SheetButton
              key={opt.id}
              ref={opt.id === approval.defaultOptionId ? defaultRef : undefined}
              tone={opt.danger ? 'danger' : opt.id === approval.defaultOptionId ? 'primary' : 'neutral'}
              title={opt.description}
              onClick={() => pick(opt)}
            >
              {opt.label}
            </SheetButton>
          ))}
        </Buttons>
      )}
    </Sheet>
  );
}

// ---- shared chrome --------------------------------------------------------

function Sheet({
  icon,
  title,
  accent,
  initialFocusRef,
  onEscape,
  children,
}: {
  readonly icon: 'wrench' | 'spark';
  readonly title: string;
  readonly accent: string;
  readonly initialFocusRef?: React.RefObject<HTMLElement>;
  readonly onEscape?: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ containerRef, initialFocusRef, onEscape });
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="anim-fade-up"
      style={{
        margin: '0 24px 8px',
        background: 'var(--color-surface)',
        border: `1px solid ${accent}`,
        borderRadius: 14,
        boxShadow: '0 18px 40px -22px rgba(15, 23, 42, 0.4)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: 8,
            background: 'var(--color-primary-soft)',
            color: 'var(--color-primary-strong)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={15} />
        </span>
        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Buttons({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
      {children}
    </div>
  );
}

const SheetButton = forwardRef<
  HTMLButtonElement,
  {
    readonly tone: 'neutral' | 'primary' | 'danger';
    readonly onClick: () => void;
    readonly disabled?: boolean;
    readonly title?: string;
    readonly children: React.ReactNode;
  }
>(function SheetButton({ tone, onClick, disabled, title, children }, ref): JSX.Element {
  const palette =
    tone === 'primary'
      ? { bg: 'var(--color-primary-strong)', color: '#fff', border: 'transparent' }
      : tone === 'danger'
        ? { bg: 'var(--color-surface)', color: 'var(--color-red)', border: 'var(--color-card-border)' }
        : { bg: 'var(--color-surface)', color: 'var(--color-text-muted)', border: 'var(--color-card-border)' };
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...(title ? { title } : {})}
      style={{
        padding: '8px 15px',
        fontSize: 13,
        fontWeight: 600,
        color: palette.color,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 10,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
});

const bodyTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13.5,
  lineHeight: 1.55,
  color: 'var(--color-text-muted)',
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: '10px 12px',
  background: 'var(--color-input-soft)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 8,
  fontSize: 11.5,
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 220,
  overflow: 'auto',
  color: 'var(--color-text)',
};
