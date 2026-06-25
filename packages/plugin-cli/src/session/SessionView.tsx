import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from 'ink';
import { useApp } from 'ink';
import type { UserPromptAttachment } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import { setCategoryDefault } from '@moxxy/config';
import { ChatView } from '../components/ChatView.js';
import { StatusLine } from '../components/StatusLine.js';
import { estimateContextTokens } from '../context-estimate.js';
import {
  buildSlashSuggestions,
  clearTerminalScreen,
  getModeBadge,
  getModeName,
  resolveActiveDescriptor,
  resolveActiveModel,
  resolveContextWindow,
} from './helpers.js';
import { useMcpStatus } from './use-mcp-status.js';
import { useEventStream } from './use-event-stream.js';
import { useImageAttachments } from './use-image-attachments.js';
import { useTurnRunner } from './use-turn-runner.js';
import { usePermissionQueue } from './use-permission-queue.js';
import { useGlobalHotkeys } from './use-global-hotkeys.js';
import { useVoiceInput } from './use-voice-input.js';
import { makePickerHandler } from './picker-handlers.js';
import { runSlash } from './run-slash.js';
import { OverlayOrNotice } from './OverlayOrNotice.js';
import { InteractiveZone } from './InteractiveZone.js';
import type { InteractiveSessionProps } from './props.js';
import type { Overlay, Picker } from './types.js';

interface SessionViewProps {
  readonly session: Session;
  readonly registerInteractiveResolver: InteractiveSessionProps['registerInteractiveResolver'];
  readonly model?: string;
  readonly version?: string;
  readonly updateAvailable?: { readonly latest: string };
  /**
   * Prompt typed on the splash screen. Submitted automatically on mount
   * so the user's first message kicks off the first turn — they don't
   * have to retype it after the view transitions.
   */
  readonly initialPrompt?: string;
}

export const SessionView: React.FC<SessionViewProps> = ({
  session,
  registerInteractiveResolver,
  model,
  version,
  updateAvailable,
  initialPrompt,
}) => {
  const { exit } = useApp();
  const stream = useEventStream(session);
  const [systemNotice, setSystemNotice] = useState<string | null>(null);
  // Structured ephemeral overlay (mutually exclusive with systemNotice).
  // /skills and /tools render through here so they get full-color
  // typography instead of being squeezed into the yellow notice strip.
  const [overlay, setOverlay] = useState<Overlay>(null);
  // Global Ctrl+O toggle. When true, every live-tools block renders
  // expanded (every constituent call visible). Default false: each
  // block shows its verb-summary line + the latest call preview.
  const [expandToolOutputs, setExpandToolOutputs] = useState(false);
  const [yolo, setYolo] = useState(false);
  const { mcpStatus, refreshMcpStatus } = useMcpStatus(session);
  // Mid-session model override. When the user picks a model via /model,
  // this takes precedence over the prop passed in at mount time.
  const [activeModelOverride, setActiveModelOverride] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const permissions = usePermissionQueue(session, registerInteractiveResolver);
  const images = useImageAttachments((msg) => setSystemNotice(msg));
  const voice = useVoiceInput({ session, setSystemNotice });

  // Keep the yolo flag in a ref so the permission handler closure
  // reads the latest value without re-registering.
  useEffect(() => {
    permissions.yoloRef.current = yolo;
  }, [yolo, permissions.yoloRef]);

  const turn = useTurnRunner({
    session,
    resolveModel: () => activeModelOverride ?? model,
    stream,
  });

  const pendingPermission = permissions.pendingPermission;
  const pendingApproval = permissions.pendingApproval;
  const overlayOpen =
    overlay != null || picker != null || pendingPermission != null || pendingApproval != null;

  useGlobalHotkeys({
    busy: turn.busy,
    overlayOpen,
    turnControllerRef: turn.turnControllerRef,
    setSystemNotice,
  });

  // Hotkeys that need to reach inside PromptInput. Routed through
  // parse-input.ts since Ink's useInput stops firing once the editor
  // owns the stdin stream (data-mode flowing vs. readable-mode read()).
  const commandHotkeys: Record<string, () => void> = {
    t: () => {
      const moved = turn.forceSendFirst();
      setSystemNotice(
        moved
          ? 'queue: first message will run next, by itself'
          : 'queue: nothing queued to force-send',
      );
    },
    b: () => {
      const dropped = turn.dropFirst();
      setSystemNotice(
        dropped ? 'queue: dropped the first queued message' : 'queue: nothing to drop',
      );
    },
    o: () => {
      setExpandToolOutputs((e) => {
        const next = !e;
        setSystemNotice(
          next
            ? 'tool blocks expanded — Ctrl+O again to collapse'
            : 'tool blocks collapsed — Ctrl+O again to expand',
        );
        return next;
      });
    },
    r: voice.toggleVoiceInput,
  };

  // Snapshot per-tool compact-presentation metadata from the live tool
  // registry. Built once per session (plugins register at boot); MCP
  // hot-attach won't surface here until the next session, which is
  // acceptable since MCP tools rarely declare `compact` anyway. The
  // stable map identity drives a memo in pairToolEvents.
  const compactTools = useMemo(() => {
    const m = new Map<string, NonNullable<ReturnType<typeof session.tools.list>[number]['compact']>>();
    for (const tool of session.tools.list()) {
      if (tool.compact) m.set(tool.name, tool.compact);
    }
    return m;
  }, [session]);

  const providerName = session.providers.getActiveName() ?? '(none)';
  const activeModel = resolveActiveModel(session, activeModelOverride, model);
  const contextWindow = resolveContextWindow(session, activeModel);
  // Re-estimated every render (~30Hz while streaming), but the estimator is
  // incrementally cached per log: an unchanged log is a pure cache hit and an
  // append folds in only the new events — no full re-walk on the render path.
  const contextUsed = estimateContextTokens(session.log);
  const modeName = getModeName(session);
  const modeBadge = getModeBadge(session);

  // Shift+Tab (and /mode) advance to the next registered mode, wrapping
  // around. Mirrors the model/loop picker's persistence so the choice
  // survives across sessions. setSystemNotice forces the re-render that
  // refreshes the footer's mode label.
  const cycleMode = React.useCallback(() => {
    const modes = session.modes.list();
    if (modes.length === 0) return;
    let current: string;
    try {
      current = session.modes.getActive().name;
    } catch {
      current = '';
    }
    const idx = modes.findIndex((m) => m.name === current);
    const next = modes[(idx + 1) % modes.length]!;
    try {
      session.modes.setActive(next.name);
      void setCategoryDefault('mode', next.name).catch(() => undefined);
      setSystemNotice(`mode → ${next.name}`);
    } catch {
      /* registry empty or name vanished — leave the active mode as-is */
    }
  }, [session]);

  const slashSuggestions = React.useMemo(() => buildSlashSuggestions(session), [session]);

  const handlePickerSelect = React.useMemo(
    () =>
      makePickerHandler({
        session,
        providerName,
        setPicker,
        setSystemNotice,
        setActiveModelOverride,
        refreshMcpStatus,
      }),
    [session, providerName, refreshMcpStatus],
  );

  // Channel-side handler for `session-action` outputs returned by
  // commands registered in `session.commands`. The actual TUI state
  // mutations (clearing scrollback, aborting turns, exiting Ink) live
  // here because the registry handlers are channel-agnostic.
  const performSessionAction = (action: 'new' | 'clear' | 'exit', notice?: string): void => {
    if (action === 'exit') {
      exit();
      return;
    }
    clearTerminalScreen();
    stream.setEvents([]);
    stream.cancelStreamFlush();
    stream.setStreamingDelta('');
    stream.streamingBufferRef.current = '';
    stream.setReasoningDelta('');
    stream.reasoningBufferRef.current = '';
    if (action === 'clear') {
      if (notice) setSystemNotice(notice);
      return;
    }
    // 'new': full session reset.
    const ctrl = turn.turnControllerRef.current;
    if (ctrl && !ctrl.signal.aborted) ctrl.abort('user reset');
    setOverlay(null);
    for (const p of permissions.pendingPermissions) {
      p.resolve({ mode: 'deny', reason: '/new — session reset' });
    }
    permissions.setPendingPermissions([]);
    permissions.setPendingApproval(null);
    turn.setBusy(false);
    setYolo(false);
    turn.queueRef.current = [];
    turn.setQueueCount(0);
    // Drop any force-sent priority message too. Aborting the turn above runs
    // its finally, which drains the priority slot — without this, a message
    // force-sent (Ctrl+T) before /new would execute AFTER the wipe and
    // re-seed the just-cleared context.
    turn.setPriority(null);
    // Wipe the history at its source. `session.reset` is the authoritative
    // path on both session kinds: a local Session clears its EventLog AND
    // truncates the persistence sidecar (so --resume can't resurrect the
    // wiped history); a RemoteSession asks the runner, which clears ITS log
    // and re-syncs every attached mirror. Falling back to a mirror-only
    // `log.clear()` would leave the runner's context intact and desync this
    // mirror, so only claim success when the reset actually happened.
    if (typeof session.reset === 'function') {
      void session.reset().then(
        () => {
          if (notice) setSystemNotice(notice);
        },
        (err: unknown) => {
          setSystemNotice(
            `/new failed: ${err instanceof Error ? err.message : String(err)} — history NOT cleared`,
          );
        },
      );
    } else {
      session.log.clear();
      if (notice) setSystemNotice(notice);
    }
  };

  const handleSubmit = async (text: string): Promise<void> => {
    setSystemNotice(null);
    setOverlay(null);
    if (text.startsWith('/')) {
      runSlash(text, {
        session,
        providerName,
        activeModel,
        modeName,
        setSystemNotice,
        setOverlay,
        setYolo,
        setPicker,
        queueRef: turn.queueRef,
        setQueueCount: turn.setQueueCount,
        performSessionAction,
        // Start a turn directly (e.g. /goal kicking off autonomous work)
        // without clearing the just-set system notice. Objectives are plain
        // text, so no image-attachment resolution is needed.
        submitPrompt: (prompt: string) => {
          if (turn.busyRef.current) {
            turn.queueRef.current.push({ text: prompt, attachments: [] });
            turn.setQueueCount(turn.queueRef.current.length);
            return;
          }
          void turn.runTurnWith(prompt, []);
        },
      });
      return;
    }

    // Resolve image attachments at submit time so each queued message
    // carries its own snapshot of bytes; the placeholder counter resets
    // here so the next message starts numbering from #1 again.
    const resolved = await images.resolveAttachments(
      text,
      resolveActiveDescriptor(session, activeModel),
      providerName,
      activeModel,
    );
    if (!Array.isArray(resolved)) {
      setSystemNotice(resolved.error);
      return;
    }
    const attachments = resolved as UserPromptAttachment[];

    if (turn.busyRef.current) {
      turn.queueRef.current.push({ text, attachments });
      turn.setQueueCount(turn.queueRef.current.length);
      return;
    }

    await turn.runTurnWith(text, attachments);
  };

  // Hand off the prompt the user typed on the splash screen. Fires
  // once after mount — `firedInitial` guards against re-fires if the
  // wrapper ever re-renders us with the same prop.
  const firedInitial = useRef(false);
  useEffect(() => {
    if (firedInitial.current) return;
    if (!initialPrompt) return;
    firedInitial.current = true;
    void handleSubmit(initialPrompt);
    // handleSubmit closes over the latest state via refs; intentionally fired
    // once per initialPrompt. (react-hooks/exhaustive-deps is not wired in the
    // root lint config; re-add a disable directive here if it is.)
  }, [initialPrompt]);

  // One-line "update available" banner, shown once on mount via the same
  // auto-dismissing notice strip as voice/queue messages (clears on first
  // submit). Skipped when an initial prompt is already running — that turn
  // would clear it instantly anyway.
  const firedUpdateNotice = useRef(false);
  useEffect(() => {
    if (firedUpdateNotice.current || !updateAvailable || initialPrompt) return;
    firedUpdateNotice.current = true;
    setSystemNotice(`✨ moxxy ${updateAvailable.latest} available — run \`moxxy update\``);
  }, [updateAvailable, initialPrompt]);

  return (
    <Box flexDirection="column">
      <ChatView
        events={stream.events}
        streamingDelta={stream.streamingDelta}
        reasoningDelta={stream.reasoningDelta}
        expandToolOutputs={expandToolOutputs}
        compactTools={compactTools}
        hideLive={
          overlay != null ||
          picker != null ||
          pendingPermission != null ||
          pendingApproval != null
        }
      />
      <OverlayOrNotice
        overlay={overlay}
        systemNotice={systemNotice}
        session={session}
        events={stream.events}
        contextWindow={contextWindow}
        contextTokens={contextUsed}
        onClose={() => setOverlay(null)}
      />
      <InteractiveZone
        session={session}
        pendingPermission={pendingPermission}
        pendingPermissionDepth={Math.max(0, permissions.pendingPermissions.length - 1)}
        pendingApproval={pendingApproval}
        picker={picker}
        busy={turn.busy}
        voiceReady={voice.ready}
        voicePhase={voice.phase}
        yolo={yolo}
        slashCommands={slashSuggestions}
        queueMessages={turn.queueRef.current}
        priorityMessage={turn.priorityMessage}
        commandHotkeys={commandHotkeys}
        onCycleMode={cycleMode}
        externalInsert={voice.externalInsert}
        onPermissionDecide={(perm, decision) => {
          permissions.setPendingPermissions((prev) => prev.slice(1));
          if (decision.mode === 'allow_always') {
            void session.permissions
              .addAllow({ name: perm.call.name, reason: 'allow_always via TUI dialog' })
              .catch(() => undefined);
          }
          perm.resolve(decision);
        }}
        onApprovalDecide={(decision) => {
          if (!pendingApproval) return;
          const { resolve } = pendingApproval;
          permissions.setPendingApproval(null);
          resolve(decision);
        }}
        onPickerSelect={handlePickerSelect}
        onPickerCancel={() => setPicker(null)}
        onSubmit={handleSubmit}
        onPasteText={images.handlePasteText}
      />
      <StatusLine
        busyStartedAt={
          turn.busy && !pendingPermission && !pendingApproval ? turn.busyStartedAt : null
        }
        queueCount={turn.queueCount}
        modeName={modeName}
        modeBadge={modeBadge}
        provider={providerName}
        model={activeModel}
        mcp={mcpStatus}
        contextUsed={contextUsed}
        {...(contextWindow ? { contextWindow } : {})}
        {...(version ? { version } : {})}
        {...(updateAvailable ? { updateLatest: updateAvailable.latest } : {})}
      />
    </Box>
  );
};
