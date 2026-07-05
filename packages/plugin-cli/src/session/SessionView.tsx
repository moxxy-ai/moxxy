import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from 'ink';
import { useApp } from 'ink';
import type { UserPromptAttachment } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import { isSelectableMode } from '@moxxy/sdk';
import { setCategoryDefault } from '@moxxy/config';
import { ChatView } from '../components/ChatView.js';
import { StatusLine } from '../components/StatusLine.js';
import { estimateContextTokens } from '../context-estimate.js';
import {
  buildSlashSuggestions,
  parseTuiKeyOverrides,
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
import { useReadAloud } from './use-read-aloud.js';
import { applyProviderModelSwitch, makePickerHandler } from './picker-handlers.js';
import { runSlash } from './run-slash.js';
import { OverlayOrNotice } from './OverlayOrNotice.js';
import { InteractiveZone } from './InteractiveZone.js';
import type { InteractiveSessionProps } from './props.js';
import type { Overlay, Picker } from './types.js';
import type { SessionSwitchTarget } from './sessions-picker.js';

interface SessionViewProps {
  readonly session: Session;
  readonly registerInteractiveResolver: InteractiveSessionProps['registerInteractiveResolver'];
  readonly getVault?: InteractiveSessionProps['getVault'];
  readonly getChannels?: InteractiveSessionProps['getChannels'];
  readonly model?: string;
  readonly version?: string;
  readonly updateAvailable?: { readonly latest: string };
  /**
   * Prompt typed on the splash screen. Submitted automatically on mount
   * so the user's first message kicks off the first turn — they don't
   * have to retype it after the view transitions.
   */
  readonly initialPrompt?: string;
  /**
   * One-shot notice shown when the view mounts (e.g. "switched session"). Unlike
   * `initialPrompt` it doesn't start a turn — it just seeds the notice strip.
   */
  readonly initialNotice?: string;
  /**
   * Whether the host can re-bootstrap onto a different session. Gates whether
   * `/sessions` opens the switcher (true) or shows a degrade notice (false).
   */
  readonly canSwitchSession?: boolean;
  /**
   * Ask the host to switch the TUI onto another session. BootShell owns the
   * session state + re-mount; this resolves on success and rejects on failure so
   * the picker handler can surface the error on the still-live session.
   */
  readonly onSwitchSession?: (target: SessionSwitchTarget) => Promise<void>;
}

export const SessionView: React.FC<SessionViewProps> = ({
  session,
  registerInteractiveResolver,
  getVault,
  getChannels,
  model,
  version,
  updateAvailable,
  initialPrompt,
  initialNotice,
  canSwitchSession,
  onSwitchSession,
}) => {
  const { exit } = useApp();
  const stream = useEventStream(session);
  const [systemNotice, setSystemNotice] = useState<string | null>(initialNotice ?? null);
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
  // Read-aloud (`/speak`): synthesize + play assistant replies through the
  // session's active Synthesizer. `onTurnComplete` (below) drives auto-speak.
  const readAloud = useReadAloud({ session, setSystemNotice });

  // Keep the yolo flag in a ref so the permission handler closure
  // reads the latest value without re-registering.
  useEffect(() => {
    permissions.yoloRef.current = yolo;
  }, [yolo, permissions.yoloRef]);

  const turn = useTurnRunner({
    session,
    resolveModel: () => activeModelOverride ?? model,
    stream,
    // Auto-speak seam: when read-aloud is armed, speak the final reply once the
    // turn completes. Reads the reply from session.log; never blocks input.
    onTurnComplete: () => readAloud.onTurnComplete(),
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
  // Ctrl+<letter> assignments honor `tui.keys` overrides (env-projected by
  // the launcher); the voice key stays fixed on 'r'.
  const tuiKeys = parseTuiKeyOverrides(process.env.MOXXY_TUI_KEYS);
  const commandHotkeys: Record<string, () => void> = {
    [tuiKeys.forceSend]: () => {
      const moved = turn.forceSendFirst();
      setSystemNotice(
        moved
          ? 'queue: first message will run next, by itself'
          : 'queue: nothing queued to force-send',
      );
    },
    [tuiKeys.dropQueued]: () => {
      const dropped = turn.dropFirst();
      setSystemNotice(
        dropped ? 'queue: dropped the first queued message' : 'queue: nothing to drop',
      );
    },
    [tuiKeys.toggleTools]: () => {
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
    // Only cycle user-selectable modes — special modes (e.g. collaborative,
    // entered via /collab) are hidden from the Shift+Tab cycle the same way they
    // are from the /mode picker. See ModeDef.special / isSelectableMode.
    const modes = session.modes.list().filter(isSelectableMode);
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

  // Guards against a second picker-driven npm install while one is running.
  // npm itself is mutex-serialized host-side; this is purely UX (one clear
  // "still installing" notice instead of a silently queued second install).
  const installInFlightRef = React.useRef(false);

  // Inline provider connect: `/model` on an unconnected provider opens the
  // ProviderConnectDialog (install + key entry / OAuth) instead of telling
  // the user to quit and run `moxxy init`. Carries the pending model pick so
  // a successful connect completes the exact switch the user asked for.
  const [providerConnect, setProviderConnect] = React.useState<{
    providerId: string;
    modelId: string;
  } | null>(null);

  // Post-install / /setup plugin-configuration dialog. Carries an optional
  // continuation (install-confirm's slash rerun waits for configuration).
  const [pluginSetup, setPluginSetup] = React.useState<{
    packageName: string;
    spec: import('@moxxy/sdk').PluginSetupSpec;
    then?: () => void;
  } | null>(null);

  // Late-bound so the picker handler (memoized above handleSubmit's
  // declaration) can re-dispatch a slash line through the normal submit path
  // — used by install-confirm to re-run the command that hit the missing
  // capability once its package is installed.
  const rerunSlashRef = React.useRef<(line: string) => void>(() => undefined);

  const handlePickerSelect = React.useMemo(
    () =>
      makePickerHandler({
        session,
        providerName,
        setPicker,
        setSystemNotice,
        setActiveModelOverride,
        refreshMcpStatus,
        installInFlightRef,
        openProviderConnect: setProviderConnect,
        openPluginSetup: setPluginSetup,
        rerunSlash: (line) => rerunSlashRef.current(line),
        ...(onSwitchSession ? { requestSessionSwitch: onSwitchSession } : {}),
      }),
    [session, providerName, refreshMcpStatus, onSwitchSession],
  );

  // Channel-side handler for `session-action` outputs returned by
  // commands registered in `session.commands`. The actual TUI state
  // mutations (clearing scrollback, aborting turns, exiting Ink) live
  // here because the registry handlers are channel-agnostic.
  const performSessionAction = (action: 'new' | 'clear' | 'exit', notice?: string): void => {
    if (action === 'exit') {
      readAloud.stop();
      exit();
      return;
    }
    // Stop any read-aloud playback so a wiped/cleared session isn't still
    // speaking the reply that just scrolled off.
    readAloud.stop();
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

  // A cancelled REQUIRED setup mirrors init's skip semantics: applySetup with
  // no values computes incompleteness and disables the package.
  const deactivateIncompleteSetup = (packageName: string): void => {
    void session.pluginsAdmin?.applySetup?.(packageName, {}).catch(() => undefined);
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
        runSpeak: (arg: string) => readAloud.handleCommand(arg),
        canSwitchSession: canSwitchSession ?? false,
        // `/collab` re-points the TUI onto the dedicated coordinator via the same
        // in-place switch machinery `/sessions` uses (so it needs the host's
        // switch capability). A collab switch carries the goal to auto-submit.
        ...(onSwitchSession
          ? {
              requestCollab: (goal?: string) => {
                void onSwitchSession({ kind: 'collab', ...(goal ? { goal } : {}) });
              },
            }
          : {}),
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
  rerunSlashRef.current = (line: string) => {
    void handleSubmit(line);
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
        {...(getVault ? { getVault } : {})}
        {...(getChannels ? { getChannels } : {})}
        onClose={() => setOverlay(null)}
      />
      <InteractiveZone
        session={session}
        pendingPermission={pendingPermission}
        pendingPermissionDepth={Math.max(0, permissions.pendingPermissions.length - 1)}
        pendingApproval={pendingApproval}
        picker={picker}
        pluginSetup={pluginSetup}
        onPluginSetupFinish={(values) => {
          const target = pluginSetup;
          setPluginSetup(null);
          if (!target) return;
          const after = target.then;
          if (values === null) {
            if (target.spec.required) {
              deactivateIncompleteSetup(target.packageName);
              setSystemNotice(
                `setup cancelled — ${target.packageName} stays disabled until configured (/setup ${target.packageName})`,
              );
            } else {
              setSystemNotice(`setup skipped — /setup ${target.packageName} to configure later`);
            }
            after?.();
            return;
          }
          void (async () => {
            try {
              const res = await session.pluginsAdmin?.applySetup?.(target.packageName, values);
              if (res && !res.complete) {
                setSystemNotice(
                  `⚠ ${target.packageName} setup incomplete (missing: ${res.missing.join(', ')})` +
                    (target.spec.required ? ' — package disabled until configured' : ''),
                );
              } else {
                setSystemNotice(`✓ ${target.packageName} configured`);
              }
            } catch (err) {
              setSystemNotice(
                `setup failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            } finally {
              after?.();
            }
          })();
        }}
        providerConnect={providerConnect}
        onProviderConnectSuccess={(note) => {
          const target = providerConnect;
          setProviderConnect(null);
          if (note) setSystemNotice(note);
          if (target) {
            void applyProviderModelSwitch(
              { session, providerName, setSystemNotice, setActiveModelOverride },
              target.providerId,
              target.modelId,
            );
          }
        }}
        onProviderConnectCancel={() => setProviderConnect(null)}
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
        onPickerCancel={() => {
          // Third-party install consent fails CLOSED: dismissing the picker
          // (ESC / ctrl-c) counts as declining, so the freshly installed
          // package gets disabled instead of silently staying enabled.
          if (picker?.kind === 'install-consent') {
            handlePickerSelect(picker, 'disable');
            return;
          }
          setPicker(null);
        }}
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
