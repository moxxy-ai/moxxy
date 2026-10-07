import { forwardRef, useCallback, useRef, useState } from 'react';
import { assertDefined } from '@/lib/assert';
import { summarizeArgs, oneLine } from '@moxxy/chat-model';
import type { AskRequest, ApprovalRequest, ApprovalOption } from '@moxxy/desktop-ipc-contract';
import { Icon } from '@moxxy/desktop-ui';
import { askStore } from '@moxxy/client-core';
import { MarkdownBody } from './MarkdownBody';
import { useFocusTrap } from './useFocusTrap';

/**
 * The card above the composer when the runner needs a decision: a tool-call
 * permission gate or a loop-strategy approval (research, BMAD, …). The runner
 * blocks on the answer, so this is modal-in-spirit: the user picks an option
 * and we reply over `ask.respond`, unblocking the turn.
 *
 * What the agent wrote is read as prose; the one exception is a tool's call,
 * which stays monospace on one line because it is the text being vouched for.
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
    <Sheet icon="spark" title={`${workflow.workflow} is waiting`} tone="caution">
      <p className="ask-dock__text">
        <strong>{workflow.label}</strong>
        {workflow.stepId ? ` · ${workflow.stepId}` : ''}
      </p>
      <Prose text={workflow.prompt} />
      <textarea
        autoFocus
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && reply.trim()) send();
        }}
        placeholder="Type your reply…"
        rows={3}
        className="ask-dock__field"
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
      title={`${tool?.name ?? 'A tool'} needs your approval`}
      // The label names the tool first: "which tool" is the fact a
      // screen-reader user needs before anything else.
      label={`approval required · ${tool?.name ?? 'tool'}`}
      tone="caution"
      initialFocusRef={denyRef}
      onEscape={onEscape}
    >
      {summary && <pre className="ask-dock__cmd">{summary}</pre>}
      {tool?.description && <p className="ask-dock__text">{tool.description}</p>}
      <div className="ask-dock__acts">
        <SheetButton tone="primary" onClick={() => decide('allow_session')}>
          Allow once
        </SheetButton>
        <SheetButton tone="neutral" onClick={() => decide('allow_always')}>
          Always allow {tool?.name ?? 'this'}
        </SheetButton>
        <SheetButton ref={denyRef} tone="danger" onClick={() => decide('deny')}>
          Deny
        </SheetButton>
        {/* Only what is actually wired. The design's strip also promised "⏎ allow",
            which would mean Enter approving a tool call on a panel that focuses
            Deny — a safety change nobody asked for, and a lie until it is made. */}
        <span className="ask-dock__keys">Esc denies</span>
      </div>
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
      tone="accent"
      initialFocusRef={initialFocusRef}
      onEscape={onEscape}
    >
      <Prose text={approval.body} />
      {textOption ? (
        <>
          <textarea
            ref={textRef}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={textOption.textPrompt ?? 'Add details…'}
            rows={3}
            className="ask-dock__field"
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

/** What the agent wrote to explain the question. */
function Prose({ text }: { readonly text: string }): JSX.Element | null {
  const body = text.trim();
  if (!body) return null;
  return (
    <div className="ask-dock__body">
      <MarkdownBody text={body} streaming={false} />
    </div>
  );
}

function Sheet({
  icon,
  title,
  label,
  tone,
  initialFocusRef,
  onEscape,
  children,
}: {
  readonly icon: 'wrench' | 'spark';
  readonly title: string;
  /** The accessible name, when it should differ from the visible title. */
  readonly label?: string;
  /** A caution asks leave to act; an accent asks which way to go on. */
  readonly tone: 'caution' | 'accent';
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
      aria-label={label ?? title}
      data-testid="ask-dock"
      data-tone={tone}
      className="ask-dock"
    >
      <div className="ask-dock__head">
        <span className="ask-dock__mark" aria-hidden>
          <Icon name={icon} size={13} />
        </span>
        <span className="ask-dock__title">{title}</span>
      </div>
      {children}
    </div>
  );
}

/** The dock's action row, shared by all three ask kinds so they lay out alike. */
function Buttons({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return <div className="ask-dock__acts">{children}</div>;
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
  return (
    <button
      ref={ref}
      type="button"
      className="ask-btn"
      data-tone={tone}
      onClick={onClick}
      disabled={disabled}
      {...(title ? { title } : {})}
    >
      {children}
    </button>
  );
});
