/**
 * Inline style tokens + the keyframe stylesheet for the focus widget.
 *
 * Flat. Sharp-cornered. No transitions on the things that
 * resize/relayout (those caused the bounce on collapse). Kept in one
 * module so every stage component (inactive / active / mini-text) and
 * the shared primitives pull the same `style` record.
 */

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
    background: PANEL_BG,
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
    width: 44,
    height: 44,
    border: PANEL_BORDER,
    background: PANEL_BG,
    borderRadius: 16,
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
    boxShadow: 'var(--focus-panel-shadow)',
    // z-index keeps the click target on top of any future overlay
    // chrome we might add (busy-state ring, etc.).
    position: 'relative',
    zIndex: 1,
    ...noDrag,
  },
  replyPreviewBubble: {
    maxWidth: 342,
    minHeight: 64,
    maxHeight: 84,
    boxSizing: 'border-box',
    padding: '10px 14px',
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
  activeRoot: {
    width: '100%',
    height: '100%',
    background: PANEL_BG,
    border: PANEL_BORDER,
    borderRadius: 28,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px',
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
  activeBrand: {
    width: 36,
    height: 36,
    padding: 0,
    margin: 0,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative',
    zIndex: 1,
    ...noDrag,
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
  `;
  if (!existing) document.head.appendChild(styleTag);
}
