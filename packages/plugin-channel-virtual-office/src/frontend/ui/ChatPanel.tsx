/**
 * Right-hand chat panel for the selected office worker (one moxxy session).
 * Header: rename / mode switch / remove / close. Body: the live transcript
 * via @moxxy/client-core's useChat + buildRenderNodes/groupToolNodes (the
 * same fold the desktop renders), the pending-ask card, and the composer
 * (Enter sends, `/` runs slash commands). In demo mode only the shell
 * renders — no transport-backed hooks are mounted.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { AskRequest } from '@moxxy/desktop-ipc-contract';
import {
  askStore,
  buildRenderNodes,
  chatStore,
  groupToolNodes,
  toErrorMessage,
  useActiveAsk,
  useChat,
  type Extension,
  type FoldedBlock,
  type RenderNode,
} from '@moxxy/client-core';
import { api } from '@moxxy/client-core/transport';

import { officeUiStore, type RosterEntry } from '../bridge/officeUiStore.js';

// ---- helpers ---------------------------------------------------------------

const JSON_PREVIEW_LIMIT = 600;

function prettyJson(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input, null, 2) ?? String(input);
  } catch {
    text = String(input);
  }
  return text.length > JSON_PREVIEW_LIMIT ? `${text.slice(0, JSON_PREVIEW_LIMIT)}…` : text;
}

type ToolOutcome =
  | { readonly type: 'tool_result'; readonly ok: boolean; readonly error?: { message: string } }
  | { readonly type: 'denied'; readonly reason: string }
  | null;

function toolStatus(outcome: ToolOutcome): { label: string; err: boolean } {
  if (outcome === null) return { label: '…', err: false };
  if (outcome.type === 'denied') return { label: 'denied', err: true };
  return outcome.ok ? { label: 'ok', err: false } : { label: 'err', err: true };
}

// ---- transcript pieces -------------------------------------------------------

function ToolRow({
  name,
  input,
  outcome,
}: {
  readonly name: string;
  readonly input: unknown;
  readonly outcome: ToolOutcome;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const status = toolStatus(outcome);
  const errMessage =
    outcome && outcome.type === 'tool_result' && !outcome.ok
      ? (outcome.error?.message ?? null)
      : outcome && outcome.type === 'denied'
        ? outcome.reason
        : null;
  return (
    <div
      className={`vo-tool${status.err ? ' vo-tool--err' : ''}`}
      onClick={() => setOpen((v) => !v)}
    >
      ⚙ {name} → {status.label}
      {open ? (
        <div className="vo-tool-detail" onClick={(e) => e.stopPropagation()}>
          {prettyJson(input)}
          {errMessage ? `\n\n✗ ${errMessage}` : ''}
        </div>
      ) : null}
    </div>
  );
}

function EventRow({ event }: { readonly event: MoxxyEvent }): JSX.Element | null {
  switch (event.type) {
    case 'user_prompt':
      return <div className="vo-bubble vo-bubble--user">{event.text}</div>;
    case 'assistant_message':
      return <div className="vo-bubble vo-bubble--assistant">{event.content}</div>;
    case 'error':
      return <div className="vo-sys vo-sys--error">✗ {event.message}</div>;
    case 'abort':
      return <div className="vo-sys">■ aborted{event.reason ? ` — ${event.reason}` : ''}</div>;
    default:
      // approvals/denials are folded into their tool-call rows; the rest is noise.
      return null;
  }
}

function BlockRow({ block }: { readonly block: FoldedBlock }): JSX.Element | null {
  switch (block.kind) {
    case 'event':
      return <EventRow event={block.event} />;
    case 'tool-call':
      return <ToolRow name={block.request.name} input={block.request.input} outcome={block.outcome} />;
    case 'live-tools':
      return (
        <>
          {block.calls.map((c) => (
            <ToolRow key={c.id} name={c.request.name} input={c.request.input} outcome={c.outcome} />
          ))}
        </>
      );
    case 'skill-scope':
      return (
        <div className="vo-skill">
          <div className="vo-sys">✦ skill: {block.skillEvent.name}</div>
          {block.children.map((child) => (
            <BlockRow key={child.id} block={child} />
          ))}
        </div>
      );
    case 'subagent': {
      const state = block.completedAtMs === null ? 'running' : block.error ? 'failed' : 'done';
      return (
        <div className={`vo-sys${block.error ? ' vo-sys--error' : ''}`}>
          ◆ agent {block.label} · {state} · {block.toolCallCount} tool
          {block.toolCallCount === 1 ? '' : 's'}
          {block.finalPreview ? ` — ${block.finalPreview}` : ''}
        </div>
      );
    }
    default:
      return null;
  }
}

function ExtRow({ ext }: { readonly ext: Extension }): JSX.Element {
  if (ext.kind === 'action_result') {
    return (
      <div className={`vo-sys${ext.tone === 'error' ? ' vo-sys--error' : ext.tone === 'notice' ? ' vo-sys--notice' : ''}`}>
        /{ext.commandName}
        {ext.argsLine ? ` ${ext.argsLine}` : ''}
        {ext.text ? `\n${ext.text}` : ''}
      </div>
    );
  }
  return <div className={`vo-sys${ext.tone === 'error' ? ' vo-sys--error' : ''}`}>{ext.text}</div>;
}

function ToolGroupRow({
  node,
}: {
  readonly node: Extract<RenderNode, { kind: 'tool-group' }>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const failed = node.tools.some((t) => toolStatus(t.outcome).err);
  return (
    <div
      className={`vo-tool${failed ? ' vo-tool--err' : ''}`}
      onClick={() => setOpen((v) => !v)}
    >
      ⚙ tools ({node.tools.length}) {open ? '▾' : '▸'}
      {open ? (
        <div className="vo-group-list" onClick={(e) => e.stopPropagation()}>
          {node.tools.map((t) => (
            <ToolRow key={t.id} name={t.request.name} input={t.request.input} outcome={t.outcome} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NodeRow({ node }: { readonly node: RenderNode }): JSX.Element | null {
  switch (node.kind) {
    case 'block':
      return <BlockRow block={node.block} />;
    case 'ext':
      return <ExtRow ext={node.ext} />;
    case 'tool-group':
      return <ToolGroupRow node={node} />;
    default:
      return null;
  }
}

// ---- ask card ----------------------------------------------------------------

function AskCard({ ask }: { readonly ask: AskRequest }): JSX.Element | null {
  if (ask.kind === 'permission' && ask.tool) {
    return (
      <div className="vo-ask">
        <div className="vo-ask-title">⚠ permission: {ask.tool.name}</div>
        {ask.tool.description ? <div className="vo-ask-body">{ask.tool.description}</div> : null}
        <pre className="vo-ask-json">{prettyJson(ask.tool.input)}</pre>
        <div className="vo-ask-actions">
          <button
            type="button"
            className="vo-btn vo-btn--primary"
            onClick={() => askStore.respond(ask.requestId, { mode: 'allow' })}
          >
            Allow
          </button>
          <button
            type="button"
            className="vo-btn"
            onClick={() => askStore.respond(ask.requestId, { mode: 'allow_always' })}
          >
            Always allow
          </button>
          <button
            type="button"
            className="vo-btn vo-btn--danger"
            onClick={() => askStore.respond(ask.requestId, { mode: 'deny' })}
          >
            Deny
          </button>
        </div>
      </div>
    );
  }
  if (ask.kind === 'approval' && ask.approval) {
    const approval = ask.approval;
    return (
      <div className="vo-ask">
        <div className="vo-ask-title">⚠ {approval.title}</div>
        {approval.body ? <div className="vo-ask-body">{approval.body}</div> : null}
        <div className="vo-ask-actions">
          {approval.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`vo-btn${opt.danger ? ' vo-btn--danger' : opt.id === approval.defaultOptionId ? ' vo-btn--primary' : ''}`}
              title={opt.description}
              onClick={() => askStore.respond(ask.requestId, { optionId: opt.id })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

// ---- composer + live body ------------------------------------------------------

/** Run a leading-`/` composer line as a slash command; results land in the
 *  transcript as an action_result extension (same as desktop). */
async function runSlashCommand(
  workspaceId: string,
  line: string,
  clearChat: () => void,
): Promise<void> {
  const space = line.indexOf(' ');
  const name = (space === -1 ? line.slice(1) : line.slice(1, space)).toLowerCase();
  const args = space === -1 ? '' : line.slice(space + 1).trim();

  if (name === 'new') {
    try {
      await api().invoke('session.newSession', { workspaceId });
      clearChat();
    } catch (e) {
      chatStore.dispatch(workspaceId, {
        type: 'action_result',
        commandName: name,
        argsLine: args,
        tone: 'error',
        text: toErrorMessage(e),
      });
    }
    return;
  }

  try {
    const out = await api().invoke('session.runCommand', { workspaceId, name, args });
    if (out.kind === 'session-action' && (out.action === 'new' || out.action === 'clear')) {
      clearChat();
    }
    const text =
      out.text ??
      out.notice ??
      out.message ??
      (out.kind === 'session-action' ? `(${out.action ?? 'done'})` : '');
    chatStore.dispatch(workspaceId, {
      type: 'action_result',
      commandName: name,
      argsLine: args,
      tone: out.kind === 'error' ? 'error' : out.kind === 'noop' ? 'notice' : 'info',
      text,
    });
  } catch (e) {
    chatStore.dispatch(workspaceId, {
      type: 'action_result',
      commandName: name,
      argsLine: args,
      tone: 'error',
      text: toErrorMessage(e),
    });
  }
}

/** Transcript + ask + composer. Mounted ONLY in live mode and ONLY for the
 *  selected workspace — useChat subscribes one workspace at a time. */
function LiveBody({ workspaceId }: { readonly workspaceId: string }): JSX.Element {
  const chat = useChat(workspaceId);
  const ask = useActiveAsk(workspaceId);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  const nodes = useMemo(
    () => groupToolNodes(buildRenderNodes(chat.events, chat.extensions)),
    [chat.events, chat.extensions],
  );

  // Auto-scroll on updates unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [nodes, chat.streamingText, chat.error, ask]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const busy = chat.activeTurnId !== null || chat.sending;

  const submit = (): void => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    stickRef.current = true;
    if (text.startsWith('/')) {
      void runSlashCommand(workspaceId, text, chat.clear);
    } else {
      void chat.send(text);
    }
  };

  return (
    <>
      <div className="vo-scroll" ref={scrollRef} onScroll={onScroll}>
        {chat.hasOlder ? (
          <button type="button" className="vo-loadolder" onClick={chat.loadOlder}>
            load earlier
          </button>
        ) : null}
        {chat.loading ? <div className="vo-empty">loading…</div> : null}
        {!chat.loading && chat.isEmpty && !chat.streamingText ? (
          <div className="vo-empty">say hi — this worker is all ears</div>
        ) : null}
        {nodes.map((node, i) => (
          <NodeRow key={nodeKey(node, i)} node={node} />
        ))}
        {chat.streamingText ? (
          <div className="vo-bubble vo-bubble--assistant">
            {chat.streamingText}
            <span className="vo-caret" />
          </div>
        ) : null}
        {chat.error ? <div className="vo-sys vo-sys--error">✗ {chat.error}</div> : null}
      </div>
      {ask ? <AskCard ask={ask} /> : null}
      <div className="vo-composer">
        <textarea
          value={draft}
          rows={1}
          placeholder={busy ? 'queued after the current turn…' : 'Message, or /command'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy ? (
          <button type="button" className="vo-stop" onClick={() => void chat.abort()}>
            ■ Stop
          </button>
        ) : null}
      </div>
    </>
  );
}

function nodeKey(node: RenderNode, index: number): string {
  switch (node.kind) {
    case 'block':
      return node.block.id;
    case 'ext':
      return node.ext.id;
    case 'tool-group':
      return node.id;
    default:
      return `n${index}`;
  }
}

// ---- header + panel shell ----------------------------------------------------

function useSessionModes(
  workspaceId: string,
  live: boolean,
): { modes: ReadonlyArray<string>; activeMode: string | null; setMode: (mode: string) => void } {
  const [modes, setModes] = useState<ReadonlyArray<string>>([]);
  const [activeMode, setActiveMode] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void api()
      .invoke('session.info', { workspaceId })
      .then((info) => {
        if (cancelled || !info) return;
        setModes(info.modes);
        setActiveMode(info.activeMode);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId, live]);

  const setMode = (mode: string): void => {
    setActiveMode(mode); // optimistic — session.info confirms on next open
    void api()
      .invoke('session.setMode', { workspaceId, mode })
      .catch(() => {});
  };

  return { modes, activeMode, setMode };
}

export function ChatPanel({
  worker,
  live,
}: {
  readonly worker: RosterEntry;
  readonly live: boolean;
}): JSX.Element {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(worker.name);
  const { modes, activeMode, setMode } = useSessionModes(worker.id, live);

  const commitRename = (): void => {
    setRenaming(false);
    const name = nameDraft.trim();
    if (!name || name === worker.name) return;
    void api()
      .invoke('sessions.rename', { id: worker.id, name })
      .then(() => {
        // The roster otherwise only refreshes on connection.changed — patch
        // the HUD/header optimistically so the new name shows immediately.
        officeUiStore.setRoster(
          officeUiStore.get().roster.map((r) => (r.id === worker.id ? { ...r, name } : r)),
        );
      })
      .catch(() => {});
  };

  const remove = (): void => {
    if (!window.confirm(`Remove ${worker.name}? This deletes the session and its transcript.`)) {
      return;
    }
    void api()
      .invoke('sessions.remove', { id: worker.id })
      .then(() => officeUiStore.select(null))
      .catch(() => {});
  };

  return (
    <div className="vo-panel">
      <div className="vo-panel-head">
        {renaming && live ? (
          <input
            className="vo-rename"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setNameDraft(worker.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span
            className="vo-panel-name"
            title={live ? 'click to rename' : worker.name}
            onClick={() => {
              if (!live) return;
              setNameDraft(worker.name);
              setRenaming(true);
            }}
          >
            {worker.name}
          </span>
        )}
        {live && modes.length > 0 ? (
          <select
            className="vo-mode"
            value={activeMode ?? ''}
            onChange={(e) => setMode(e.target.value)}
            title="mode"
          >
            {activeMode === null ? <option value="" disabled /> : null}
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : null}
        {live && !worker.isPrimary ? (
          <button type="button" className="vo-remove" onClick={remove}>
            Remove
          </button>
        ) : null}
        <button
          type="button"
          className="vo-iconbtn"
          title="close"
          onClick={() => officeUiStore.select(null)}
        >
          ✕
        </button>
      </div>
      {live ? (
        <LiveBody key={worker.id} workspaceId={worker.id} />
      ) : (
        <div className="vo-demo-note">demo mode — chat is disabled</div>
      )}
    </div>
  );
}
