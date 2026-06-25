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

const PANEL_BG = '#ffffff';
const PANEL_BORDER = '1px solid rgba(15, 23, 42, 0.14)';

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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 14px 32px rgba(15, 23, 42, 0.18)',
    // z-index keeps the click target on top of any future overlay
    // chrome we might add (busy-state ring, etc.).
    position: 'relative',
    zIndex: 1,
    ...noDrag,
  },
  replyPreviewBubble: {
    maxWidth: 342,
    minHeight: 64,
    maxHeight: 64,
    boxSizing: 'border-box',
    padding: '10px 14px',
    background: 'rgba(17, 24, 39, 0.94)',
    border: '1px solid rgba(148, 163, 184, 0.28)',
    borderRadius: 22,
    boxShadow: '0 18px 44px rgba(15, 23, 42, 0.26)',
    color: '#f8fafc',
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
    background:
      'linear-gradient(145deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.96))',
    border: '1px solid rgba(236, 72, 153, 0.34)',
    borderRadius: 22,
    boxShadow: '0 22px 54px rgba(15, 23, 42, 0.32)',
    color: '#f8fafc',
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
    color: '#f9a8d4',
  },
  focusAskDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: '#ec4899',
    boxShadow: '0 0 14px rgba(236, 72, 153, 0.8)',
  },
  focusAskTitle: {
    margin: 0,
    fontSize: 14,
    lineHeight: '18px',
    fontWeight: 760,
    color: '#ffffff',
    letterSpacing: 0,
  },
  focusAskBody: {
    margin: '3px 0 0',
    fontSize: 12,
    lineHeight: '16px',
    color: '#cbd5e1',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  focusAskDetail: {
    margin: '7px 0 0',
    maxHeight: 30,
    padding: '5px 7px',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    color: '#e2e8f0',
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
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: 12,
    background: 'rgba(255, 255, 255, 0.09)',
    color: '#f8fafc',
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
    background: 'rgba(248, 113, 113, 0.13)',
    borderColor: 'rgba(248, 113, 113, 0.28)',
    color: '#fecaca',
  },
  focusAskButtonNeutral: {
    background: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.13)',
    color: '#f8fafc',
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
    background: 'rgba(15, 23, 42, 0.12)',
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
    color: '#64748b',
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
    borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
    cursor: 'grab',
    ...drag,
  },
  headerButton: {
    width: 24,
    height: 24,
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: '#64748b',
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
    color: '#64748b',
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
    color: '#0f172a',
  },
  lineRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
  composer: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 10px',
    borderTop: '1px solid rgba(15, 23, 42, 0.08)',
    background: '#fff',
    ...noDrag,
  },
  input: {
    flex: 1,
    height: 32,
    padding: '0 10px',
    fontSize: 13,
    color: '#0f172a',
    background: '#f8fafc',
    border: '1px solid rgba(15, 23, 42, 0.12)',
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
// handful of CSS custom properties MarkdownBody reads are mirrored here —
// values kept in sync with src/styles.css `:root`.

if (typeof document !== 'undefined' && !document.getElementById('focus-keyframes')) {
  const styleTag = document.createElement('style');
  styleTag.id = 'focus-keyframes';
  styleTag.textContent = `
    :root {
      --color-text: #0f172a;
      --color-text-muted: #475569;
      --color-text-dim: #94a3b8;
      --color-primary: #ec4899;
      --color-primary-strong: #db2777;
      --color-card-border: #e3e5f0;
      --color-card-border-strong: #cdd1e3;
      --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    }
    @keyframes focus-thinking {
      0%, 100% { transform: translateY(0); opacity: 0.4; }
      50%      { transform: translateY(-3px); opacity: 1; }
    }
  `;
  document.head.appendChild(styleTag);
}
