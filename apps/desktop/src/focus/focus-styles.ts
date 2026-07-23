/**
 * Inline style tokens + the keyframe stylesheet for the focus widget.
 *
 * Flat. Sharp-cornered. No transitions on the things that
 * resize/relayout (those caused the bounce on collapse). Kept in one
 * module so every stage component (inactive / active / mini-text) and
 * the shared primitives pull the same `style` record.
 */

import {
  FOCUS_PET_LAYOUT,
  FOCUS_PET_BUBBLE_LAYOUT,
} from '@moxxy/desktop-ipc-contract';

// ---- Drag regions --------------------------------------------------------
// The whole window background is the OS drag region; interactive
// controls cut a no-drag hole over their own area.

export const drag = { WebkitAppRegion: 'drag' as const };
export const noDrag = { WebkitAppRegion: 'no-drag' as const };

// ---- Logo asset ----------------------------------------------------------
// Uses the logo served from public/. Fallback to a typed glyph if the
// image fails to load (offline / dist mis-copy) — see LogoMark.

export const ASSET_LOGO = './logo.png';

// ---- Panel tokens --------------------------------------------------------

const PANEL_BG = 'var(--focus-panel-bg)';
const PANEL_BORDER = '1px solid var(--focus-panel-border)';

// ---- Styles --------------------------------------------------------------

export const style = {
  // ---- inactive --------------------------------------------------------
  inactiveRoot: {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    cursor: 'grab',
    contain: 'layout paint',
    ...noDrag,
  },
  inactiveRootWithPreview: {
    justifyContent: 'flex-start',
    gap: 12,
    padding: '10px 12px',
    background: 'transparent',
  },
  inactiveButton: {
    width: FOCUS_PET_LAYOUT.collapsedWidth,
    height: FOCUS_PET_LAYOUT.collapsedHeight,
    border: 'none',
    background: 'transparent',
    borderRadius: 0,
    boxSizing: 'border-box',
    padding: 0,
    margin: 0,
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'none',
    // z-index keeps the click target on top of any future overlay
    // chrome we might add (busy-state ring, etc.).
    position: 'relative',
    zIndex: 1,
    ...noDrag,
  },
  voiceLiveIndicator: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 8,
    height: 8,
    boxSizing: 'border-box',
    border: '2px solid var(--focus-panel-bg)',
    borderRadius: 999,
    background: 'var(--color-primary)',
    boxShadow: '0 0 10px rgba(236, 72, 153, 0.7)',
    pointerEvents: 'none',
  },
  focusPet: {
    width: '100%',
    height: '100%',
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    isolation: 'isolate',
    pointerEvents: 'none',
  },
  focusPetGlow: {
    position: 'absolute',
    inset: '23% 2% 3%',
    zIndex: -1,
    borderRadius: '50%',
    background: 'radial-gradient(ellipse at 52% 58%, rgba(236, 72, 153, 0.3), transparent 68%)',
    opacity: 0.48,
    transform: 'scale(0.92)',
    pointerEvents: 'none',
  },
  focusPetMotionLayer: {
    width: '100%',
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    transformOrigin: '50% 82%',
  },
  focusPetCanvas: {
    width: '100%',
    height: '100%',
    display: 'block',
    objectFit: 'contain',
    imageRendering: 'pixelated',
  },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
  voiceMicrophoneActionIcon: {
    width: 19,
    height: 19,
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceMicrophoneActionSlash: {
    position: 'absolute',
    left: 1,
    top: 8.5,
    width: 17,
    height: 1.8,
    borderRadius: 999,
    background: 'currentColor',
    boxShadow: '0 0 0 1px var(--focus-panel-bg)',
    transform: 'rotate(-45deg)',
    pointerEvents: 'none',
  },
  replyPreviewBubble: {
    width: '100%',
    maxWidth: 342,
    minHeight: 64,
    maxHeight: 84,
    boxSizing: 'border-box',
    paddingTop: 10,
    paddingRight: 14,
    paddingBottom: 10,
    paddingLeft: 14,
    background: 'var(--focus-preview-bg)',
    border: '1px solid var(--focus-preview-border)',
    borderRadius: 22,
    boxShadow: 'var(--focus-preview-shadow)',
    color: 'var(--focus-preview-text)',
    fontFamily: 'inherit',
    fontSize: 13.5,
    fontWeight: 650,
    lineHeight: '18px',
    textAlign: 'left',
    overflowX: 'hidden',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    display: 'block',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    appearance: 'none',
    margin: 0,
    cursor: 'pointer',
    backdropFilter: 'blur(18px) saturate(1.2)',
    ...noDrag,
  },
  focusPetBubbleRoot: {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    gap: 6,
    padding: '6px 12px 0',
    background: 'transparent',
    contain: 'layout paint',
    ...noDrag,
  },
  focusPetBubbleFrame: {
    width: FOCUS_PET_BUBBLE_LAYOUT.width - 24,
    maxWidth: '100%',
    minHeight: 68,
    position: 'relative',
    flex: '0 0 auto',
    ...noDrag,
  },
  focusTaskBubble: {
    minHeight: 68,
    maxHeight: 68,
    paddingTop: 12,
    paddingRight: 76,
    paddingBottom: 12,
    paddingLeft: 16,
    overflowX: 'hidden',
    overflowY: 'hidden',
    cursor: 'pointer',
  },
  focusReplyBubble: {
    paddingRight: 52,
  },
  focusPetBubbleLine: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
  },
  focusPetBubbleTitle: {
    color: 'var(--focus-preview-text)',
    fontWeight: 800,
  },
  focusPetBubbleSeparator: {
    margin: '0 7px',
    color: 'var(--focus-dim)',
    fontWeight: 700,
  },
  focusTaskBubbleText: {
    color: 'var(--focus-muted)',
    fontWeight: 650,
  },
  focusTaskSpinner: {
    position: 'absolute',
    right: 18,
    top: 16,
    width: 22,
    height: 22,
    boxSizing: 'border-box',
    border: '3px solid rgba(236, 72, 153, 0.22)',
    borderTopColor: 'var(--color-primary)',
    borderRadius: 999,
    pointerEvents: 'none',
  },
  focusBubbleHideButton: {
    position: 'absolute',
    right: 12,
    bottom: 6,
    width: 30,
    height: 24,
    padding: 0,
    border: 'none',
    borderRadius: 10,
    background: 'transparent',
    color: 'var(--focus-muted)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    ...noDrag,
  },
  focusPetDock: {
    width: FOCUS_PET_LAYOUT.collapsedWidth,
    height: FOCUS_PET_LAYOUT.collapsedHeight,
    position: 'relative',
    flex: '0 0 auto',
    ...noDrag,
  },
  focusActiveDock: {
    width: FOCUS_PET_LAYOUT.activeAvatarWidth - FOCUS_PET_LAYOUT.activeOverlap,
    height: FOCUS_PET_LAYOUT.activeHeight,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    flex: '0 0 auto',
    ...noDrag,
  },
  focusBubbleRestoreButton: {
    position: 'absolute',
    right: 2,
    top: 1,
    zIndex: 4,
    width: 28,
    height: 28,
    padding: 0,
    border: '1px solid var(--focus-preview-border)',
    borderRadius: 999,
    background: 'var(--focus-preview-bg)',
    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.24)',
    color: 'var(--focus-preview-text)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    backdropFilter: 'blur(14px)',
    ...noDrag,
  },
  focusAskCard: {
    boxSizing: 'border-box',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--focus-ask-bg)',
    border: '1px solid var(--focus-ask-border)',
    borderRadius: 22,
    boxShadow: 'var(--focus-ask-shadow)',
    color: 'var(--focus-ask-text)',
    fontFamily: 'inherit',
    textAlign: 'left',
    overflow: 'hidden',
    backdropFilter: 'blur(18px) saturate(1.2)',
    ...noDrag,
  },
  focusAskCardToast: {
    width: 468,
    maxHeight: 196,
  },
  focusAskCardPanel: {
    width: '100%',
    marginBottom: 12,
    maxHeight: 'none',
  },
  focusAskTopline: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  focusAskKicker: {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--focus-ask-kicker)',
  },
  focusAskDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: 'var(--color-primary)',
    boxShadow: '0 0 14px rgba(236, 72, 153, 0.8)',
  },
  focusAskTitle: {
    margin: 0,
    fontSize: 14,
    lineHeight: '18px',
    fontWeight: 760,
    color: 'var(--focus-ask-title)',
    letterSpacing: 0,
  },
  focusAskBody: {
    margin: '3px 0 0',
    fontSize: 12,
    lineHeight: '16px',
    color: 'var(--focus-ask-body)',
    maxHeight: 68,
    overflowX: 'hidden',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    wordBreak: 'break-word',
  },
  focusAskDetail: {
    margin: '10px 0 0',
    maxHeight: 30,
    padding: '5px 7px',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: 'var(--focus-ask-detail-bg)',
    border: '1px solid var(--focus-ask-detail-border)',
    borderRadius: 10,
    color: 'var(--focus-ask-detail-text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    lineHeight: '14px',
  },
  focusAskTextArea: {
    width: '100%',
    boxSizing: 'border-box',
    marginTop: 8,
    padding: '8px 9px',
    resize: 'none',
    outline: 'none',
    border: '1px solid var(--focus-ask-detail-border)',
    borderRadius: 12,
    background: 'var(--focus-ask-detail-bg)',
    color: 'var(--focus-ask-text)',
    fontFamily: 'inherit',
    fontSize: 12,
    lineHeight: '16px',
    ...noDrag,
  },
  focusAskActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
    flexShrink: 0,
    ...noDrag,
  },
  focusAskButton: {
    height: 26,
    minWidth: 54,
    maxWidth: 118,
    padding: '0 10px',
    border: '1px solid transparent',
    borderRadius: 999,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11.5,
    fontWeight: 740,
    lineHeight: '24px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    ...noDrag,
  },
  focusAskButtonDanger: {
    background: 'var(--focus-ask-danger-bg)',
    borderColor: 'var(--focus-ask-danger-border)',
    color: 'var(--focus-ask-danger-text)',
  },
  focusAskButtonNeutral: {
    background: 'var(--focus-ask-neutral-bg)',
    borderColor: 'var(--focus-ask-neutral-border)',
    color: 'var(--focus-ask-text)',
  },
  focusAskButtonPrimary: {
    background: 'linear-gradient(135deg, #ec4899, #d946ef)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    color: '#ffffff',
    boxShadow: '0 10px 22px rgba(236, 72, 153, 0.25)',
  },
  focusAskButtonDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },

  // ---- active ----------------------------------------------------------
  activeRootWithPreviewBubble: {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 12,
    padding: '10px 12px',
    background: 'transparent',
    contain: 'layout paint',
    ...noDrag,
  },
  activeChrome: {
    height: FOCUS_PET_LAYOUT.activeHeight,
    display: 'flex',
    alignItems: 'center',
    flex: '0 0 auto',
    position: 'relative',
    ...noDrag,
  },
  activePetButton: {
    width: FOCUS_PET_LAYOUT.activeAvatarWidth,
    height: FOCUS_PET_LAYOUT.activeHeight,
    padding: 0,
    margin: 0,
    border: 'none',
    borderRadius: 0,
    background: 'transparent',
    appearance: 'none',
    WebkitAppearance: 'none',
    cursor: 'pointer',
    position: 'relative',
    zIndex: 2,
    flex: '0 0 auto',
    ...noDrag,
  },
  activeRoot: {
    height: 56,
    background: PANEL_BG,
    border: PANEL_BORDER,
    borderRadius: 28,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px 0 22px',
    position: 'relative',
    overflow: 'hidden',
    // Whole panel is the drag region; the brand button + action
    // row both opt out with no-drag + position:relative so they
    // sit on top of the drag layer.
    cursor: 'grab',
    ...drag,
  },
  activeRootWithPreview: {
    height: 56,
    flex: '0 0 auto',
  },
  activeDivider: {
    width: 1,
    height: 26,
    background: 'var(--focus-divider)',
    margin: '0 6px',
    flexShrink: 0,
  },
  activeActions: {
    display: 'flex',
    gap: 2,
    marginLeft: 'auto',
    position: 'relative',
    zIndex: 1,
    ...noDrag,
  },
  actionBtn: {
    width: 34,
    height: 34,
    padding: 0,
    margin: 0,
    border: 'none',
    background: 'transparent',
    color: 'var(--focus-muted)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnActive: {
    background: 'rgba(236, 72, 153, 0.14)',
    color: 'var(--color-primary)',
    borderRadius: 11,
  },
  actionBtnDisabled: {
    opacity: 0.42,
    cursor: 'not-allowed',
  },

  // ---- mini -----------------------------------------------------------
  panel: {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    background: PANEL_BG,
    border: PANEL_BORDER,
    overflow: 'hidden',
    ...noDrag,
  },
  miniHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px',
    borderBottom: '1px solid var(--focus-subtle-border)',
    cursor: 'grab',
    ...drag,
  },
  headerButton: {
    width: 24,
    height: 24,
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: 'var(--focus-muted)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...noDrag,
  },
  miniTitle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11.5,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--focus-muted)',
    ...noDrag,
  },
  panelBody: {
    flex: 1,
    padding: '12px 14px',
    // Reads top-down like a transcript; the latest message scrolls and
    // MiniText auto-scrolls it to the bottom as the answer streams in.
    display: 'block',
    overflowY: 'auto',
    minHeight: 0,
    fontSize: 13,
    color: 'var(--focus-text)',
  },
  lineRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
  composerDock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    padding: '8px 10px',
    borderTop: '1px solid var(--focus-subtle-border)',
    background: 'var(--focus-composer-bg)',
    ...noDrag,
  },
  focusAttachmentStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: 1,
    ...noDrag,
  },
  focusAttachmentChip: {
    height: 42,
    maxWidth: 170,
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: 4,
    flexShrink: 0,
    border: '1px solid var(--focus-input-border)',
    borderRadius: 8,
    background: 'var(--focus-input-bg)',
    color: 'var(--focus-text)',
    ...noDrag,
  },
  focusAttachmentPreview: {
    minWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontFamily: 'inherit',
    ...noDrag,
  },
  focusAttachmentPending: {
    minWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    color: 'var(--focus-muted)',
  },
  focusAttachmentPendingDot: {
    width: 24,
    height: 24,
    borderRadius: 6,
    flexShrink: 0,
    background: 'var(--focus-subtle-border)',
  },
  focusAttachmentThumb: {
    width: 30,
    height: 30,
    borderRadius: 6,
    objectFit: 'cover',
    flexShrink: 0,
    background: 'var(--focus-subtle-border)',
  },
  focusAttachmentName: {
    minWidth: 0,
    maxWidth: 96,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11.5,
    fontWeight: 650,
    lineHeight: '14px',
  },
  focusAttachmentRemove: {
    width: 24,
    height: 24,
    padding: 0,
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--focus-muted)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...noDrag,
  },
  focusAttachError: {
    fontSize: 11.5,
    lineHeight: '15px',
    color: 'var(--color-red)',
  },
  composer: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    ...noDrag,
  },
  input: {
    flex: 1,
    height: 32,
    padding: '0 10px',
    fontSize: 13,
    color: 'var(--focus-text)',
    background: 'var(--focus-input-bg)',
    border: '1px solid var(--focus-input-border)',
    outline: 'none',
    fontFamily: 'inherit',
  },
  send: {
    width: 32,
    height: 32,
    border: 'none',
    background: 'linear-gradient(135deg, #ec4899, #d946ef)',
    color: '#fff',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
} satisfies Record<string, React.CSSProperties>;

// ---- Keyframes + theme vars ----------------------------------------------
// Injected once on module load so the spinner-dot animation resolves
// regardless of which stage mounts first. The focus document loads
// its own bundle and does NOT import the app's styles.css (that would set a
// non-transparent body background and break the floating window), so the
// handful of CSS custom properties MarkdownBody reads are mirrored here, plus
// focus-specific surface tokens. Values track src/styles.css' light/dark
// palette while keeping this standalone window transparent.

if (typeof document !== 'undefined') {
  const existing = document.getElementById('focus-keyframes');
  const styleTag = existing ?? document.createElement('style');
  styleTag.id = 'focus-keyframes';
  styleTag.textContent = `
    :root {
      --color-text: #0f172a;
      --color-text-muted: #475569;
      --color-text-dim: #94a3b8;
      --color-primary: #ec4899;
      --color-primary-strong: #db2777;
      --color-red: #ef4444;
      --color-card-border: #e3e5f0;
      --color-card-border-strong: #cdd1e3;
      --color-code-bg: #f1f3fb;
      --color-bg-card-hover: #f4f5fa;
      --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

      --focus-panel-bg: #ffffff;
      --focus-panel-border: rgba(15, 23, 42, 0.14);
      --focus-panel-shadow: 0 14px 32px rgba(15, 23, 42, 0.18);
      --focus-text: #0f172a;
      --focus-muted: #64748b;
      --focus-dim: #94a3b8;
      --focus-divider: rgba(15, 23, 42, 0.12);
      --focus-subtle-border: rgba(15, 23, 42, 0.08);
      --focus-action-hover-bg: rgba(15, 23, 42, 0.06);
      --focus-action-danger-bg: rgba(239, 68, 68, 0.12);
      --focus-preview-bg: rgba(255, 255, 255, 0.96);
      --focus-preview-border: rgba(203, 213, 225, 0.75);
      --focus-preview-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
      --focus-preview-text: #0f172a;
      --focus-composer-bg: #ffffff;
      --focus-input-bg: #f8fafc;
      --focus-input-border: rgba(15, 23, 42, 0.12);
      --focus-ask-bg: rgba(255, 255, 255, 0.97);
      --focus-ask-border: rgba(15, 23, 42, 0.14);
      --focus-ask-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
      --focus-ask-text: #0f172a;
      --focus-ask-title: #0f172a;
      --focus-ask-body: #475569;
      --focus-ask-kicker: #db2777;
      --focus-ask-detail-bg: rgba(15, 23, 42, 0.045);
      --focus-ask-detail-border: rgba(15, 23, 42, 0.10);
      --focus-ask-detail-text: #1e293b;
      --focus-ask-neutral-bg: rgba(15, 23, 42, 0.06);
      --focus-ask-neutral-border: rgba(15, 23, 42, 0.10);
      --focus-ask-danger-bg: rgba(239, 68, 68, 0.10);
      --focus-ask-danger-border: rgba(239, 68, 68, 0.22);
      --focus-ask-danger-text: #b91c1c;
      color-scheme: light;
    }

    [data-theme="dark"] {
      --color-text: #e8eaf6;
      --color-text-muted: #a4abc8;
      --color-text-dim: #697091;
      --color-primary: #ec4899;
      --color-primary-strong: #db2777;
      --color-red: #ef4444;
      --color-card-border: #262a3c;
      --color-card-border-strong: #363c54;
      --color-code-bg: #262b40;
      --color-bg-card-hover: #1d2030;

      --focus-panel-bg: #161823;
      --focus-panel-border: rgba(148, 163, 184, 0.22);
      --focus-panel-shadow: 0 16px 38px rgba(0, 0, 0, 0.42);
      --focus-text: #e8eaf6;
      --focus-muted: #a4abc8;
      --focus-dim: #697091;
      --focus-divider: rgba(148, 163, 184, 0.18);
      --focus-subtle-border: rgba(148, 163, 184, 0.14);
      --focus-action-hover-bg: rgba(255, 255, 255, 0.08);
      --focus-action-danger-bg: rgba(239, 68, 68, 0.16);
      --focus-preview-bg: rgba(22, 24, 35, 0.96);
      --focus-preview-border: rgba(148, 163, 184, 0.24);
      --focus-preview-shadow: 0 22px 54px rgba(0, 0, 0, 0.48);
      --focus-preview-text: #f8fafc;
      --focus-composer-bg: #101117;
      --focus-input-bg: #121420;
      --focus-input-border: #262a3c;
      --focus-ask-bg: rgba(22, 24, 35, 0.97);
      --focus-ask-border: rgba(148, 163, 184, 0.22);
      --focus-ask-shadow: 0 22px 54px rgba(0, 0, 0, 0.48);
      --focus-ask-text: #f8fafc;
      --focus-ask-title: #ffffff;
      --focus-ask-body: #cbd5e1;
      --focus-ask-kicker: #f9a8d4;
      --focus-ask-detail-bg: rgba(255, 255, 255, 0.08);
      --focus-ask-detail-border: rgba(255, 255, 255, 0.10);
      --focus-ask-detail-text: #e2e8f0;
      --focus-ask-neutral-bg: rgba(255, 255, 255, 0.10);
      --focus-ask-neutral-border: rgba(255, 255, 255, 0.13);
      --focus-ask-danger-bg: rgba(248, 113, 113, 0.13);
      --focus-ask-danger-border: rgba(248, 113, 113, 0.28);
      --focus-ask-danger-text: #fecaca;
      color-scheme: dark;
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme]) {
        --color-text: #e8eaf6;
        --color-text-muted: #a4abc8;
        --color-text-dim: #697091;
        --color-card-border: #262a3c;
        --color-card-border-strong: #363c54;
        --color-code-bg: #262b40;
        --color-bg-card-hover: #1d2030;
        --focus-panel-bg: #161823;
        --focus-panel-border: rgba(148, 163, 184, 0.22);
        --focus-panel-shadow: 0 16px 38px rgba(0, 0, 0, 0.42);
        --focus-text: #e8eaf6;
        --focus-muted: #a4abc8;
        --focus-dim: #697091;
        --focus-divider: rgba(148, 163, 184, 0.18);
        --focus-subtle-border: rgba(148, 163, 184, 0.14);
        --focus-action-hover-bg: rgba(255, 255, 255, 0.08);
        --focus-action-danger-bg: rgba(239, 68, 68, 0.16);
        --focus-preview-bg: rgba(22, 24, 35, 0.96);
        --focus-preview-border: rgba(148, 163, 184, 0.24);
        --focus-preview-shadow: 0 22px 54px rgba(0, 0, 0, 0.48);
        --focus-preview-text: #f8fafc;
        --focus-composer-bg: #101117;
        --focus-input-bg: #121420;
        --focus-input-border: #262a3c;
        --focus-ask-bg: rgba(22, 24, 35, 0.97);
        --focus-ask-border: rgba(148, 163, 184, 0.22);
        --focus-ask-shadow: 0 22px 54px rgba(0, 0, 0, 0.48);
        --focus-ask-text: #f8fafc;
        --focus-ask-title: #ffffff;
        --focus-ask-body: #cbd5e1;
        --focus-ask-kicker: #f9a8d4;
        --focus-ask-detail-bg: rgba(255, 255, 255, 0.08);
        --focus-ask-detail-border: rgba(255, 255, 255, 0.10);
        --focus-ask-detail-text: #e2e8f0;
        --focus-ask-neutral-bg: rgba(255, 255, 255, 0.10);
        --focus-ask-neutral-border: rgba(255, 255, 255, 0.13);
        --focus-ask-danger-bg: rgba(248, 113, 113, 0.13);
        --focus-ask-danger-border: rgba(248, 113, 113, 0.28);
        --focus-ask-danger-text: #fecaca;
        color-scheme: dark;
      }
    }
    .focus-ask-markdown > :last-child {
      margin-bottom: 0 !important;
    }
    @keyframes focus-thinking {
      0%, 100% { transform: translateY(0); opacity: 0.4; }
      50%      { transform: translateY(-3px); opacity: 1; }
    }
    @keyframes focus-task-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes focus-bubble-enter {
      from { transform: translateY(5px) scale(0.985); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
    .focus-pet-bubble {
      animation: focus-bubble-enter 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .focus-task-spinner {
      animation: focus-task-spin 920ms linear infinite;
    }
    .focus-bubble-hide-button:hover,
    .focus-bubble-restore-button:hover {
      background: var(--focus-action-hover-bg) !important;
      color: var(--color-primary) !important;
    }
    .focus-voice-live {
      animation: focus-voice-live 1.7s ease-in-out infinite;
    }
    .focus-voice-live[data-phase="speaking"] {
      animation-duration: 0.72s;
    }
    .focus-voice-live[data-phase="paused"] {
      animation: none;
      background: var(--focus-dim) !important;
      box-shadow: none !important;
    }
    .focus-voice-live[data-phase="error"] {
      animation: none;
      background: var(--color-red) !important;
      box-shadow: 0 0 9px rgba(239, 68, 68, 0.65) !important;
    }
    .focus-pet-canvas {
      opacity: 0;
      filter: drop-shadow(0 8px 9px rgba(9, 10, 18, 0.32));
      transition: opacity 160ms ease, filter 200ms ease;
    }
    .focus-pet-canvas[data-avatar-state="ready"] {
      opacity: 1;
    }
    .focus-pet-glow {
      transition: opacity 220ms ease, transform 220ms ease, filter 220ms ease;
    }
    .focus-pet--speaking .focus-pet-glow {
      opacity: 0.78 !important;
      transform: scale(1.05) !important;
      filter: saturate(1.16);
    }
    .focus-pet--thinking .focus-pet-glow,
    .focus-pet--working .focus-pet-glow,
    .focus-pet--synthesizing .focus-pet-glow {
      opacity: 0.62 !important;
      transform: scale(1.01) !important;
    }
    .focus-pet--waiting-for-input .focus-pet-glow {
      opacity: 0.82 !important;
      filter: hue-rotate(22deg) saturate(1.2);
    }
    .focus-pet--error .focus-pet-canvas {
      filter: saturate(0.58) sepia(0.12) drop-shadow(0 7px 8px rgba(100, 20, 34, 0.32));
    }
    .focus-pet--microphone-muted:not(.focus-pet--speaking) .focus-pet-canvas {
      filter: saturate(0.58) drop-shadow(0 8px 9px rgba(9, 10, 18, 0.28));
      opacity: 0.76;
    }
    @keyframes focus-voice-live {
      0%, 100% { transform: scale(0.86); opacity: 0.62; }
      50% { transform: scale(1); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .focus-voice-live,
      .focus-voice-live[data-phase="speaking"] {
        animation: none;
      }
      .focus-pet-canvas,
      .focus-pet-glow {
        transition: none;
      }
      .focus-pet-bubble,
      .focus-task-spinner {
        animation: none;
      }
    }
  `;
  if (!existing) document.head.appendChild(styleTag);
}
