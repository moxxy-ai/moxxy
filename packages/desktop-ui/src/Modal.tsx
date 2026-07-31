/**
 * Tiny children-based modal primitive. Replaces window.prompt /
 * window.confirm (both are no-ops or partly broken in Electron).
 *
 * Implements the standard dialog contract: focus moves into the dialog on
 * open and is restored to the trigger on close; Tab/Shift-Tab are trapped
 * to the dialog's focusable descendants; Escape closes only the top-most
 * stacked modal; background scroll is locked while open.
 *
 * Usage:
 *
 *   const [open, setOpen] = useState(false);
 *   {open && (
 *     <Modal onClose={() => setOpen(false)} title="…">
 *       <form>…</form>
 *     </Modal>
 *   )}
 */

import { useEffect, useId, useRef } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button.js';
import { IconButton } from './Button.js';
import { Icon } from './Icon.js';

interface ModalProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly width?: number;
  /**
   * Id of the element describing the dialog's body, wired to `aria-describedby`
   * so a screen reader announces the message (not just the title) on open.
   */
  readonly describedById?: string;
}

// Module-level stack of open modals so Escape only closes the top-most one
// when several are nested (e.g. a ConfirmModal opened from within a Modal).
const MODAL_STACK: symbol[] = [];

// Ref-counted background-scroll lock. Each open modal increments the count;
// the body's original `overflow` is captured only on the 0→1 transition and
// restored only on the 1→0 transition. Without ref-counting, a modal that
// closes out of LIFO order (backdrop-click / programmatic close of an inner
// dialog before its parent) would restore `overflow` while another modal is
// still open, re-enabling background scroll under it.
let scrollLockCount = 0;
let savedBodyOverflow = '';

function acquireScrollLock(): void {
  if (typeof document === 'undefined') return;
  const body = document.body;
  if (scrollLockCount === 0) {
    savedBodyOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function releaseScrollLock(): void {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) return;
  scrollLockCount -= 1;
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
    savedBodyOverflow = '';
  }
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function Modal({
  title,
  children,
  onClose,
  width = 380,
  describedById,
}: ModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  // Read the latest onClose from the keydown handler without re-binding the
  // mount effect (which would re-steal focus on every parent render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const token = Symbol('modal');
    MODAL_STACK.push(token);
    const isTop = (): boolean => MODAL_STACK[MODAL_STACK.length - 1] === token;

    // Remember the trigger so focus can be restored on close.
    const prevActive =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

    // Move focus into the dialog (first focusable, else the dialog itself),
    // unless an `autoFocus` child already claimed focus inside it.
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const first = focusableWithin(dialog)[0];
      (first ?? dialog).focus();
    }

    // Lock background scroll for the modal's lifetime (ref-counted so an inner
    // dialog closing before its parent doesn't unlock scroll under the parent).
    acquireScrollLock();

    const onKey = (e: KeyboardEvent): void => {
      if (!isTop()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && dialog) {
        const focusable = focusableWithin(dialog);
        if (focusable.length === 0) {
          // Nothing tabbable inside — keep focus pinned to the dialog.
          e.preventDefault();
          dialog.focus();
          return;
        }
        const firstEl = focusable[0]!;
        const lastEl = focusable[focusable.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === firstEl || !dialog.contains(active)) {
            e.preventDefault();
            lastEl.focus();
          }
        } else if (active === lastEl || !dialog.contains(active)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    // Capture phase so the trap runs before inner handlers and we can scope
    // Escape to the top-most modal only.
    window.addEventListener('keydown', onKey, true);

    return () => {
      window.removeEventListener('keydown', onKey, true);
      const idx = MODAL_STACK.indexOf(token);
      if (idx !== -1) MODAL_STACK.splice(idx, 1);
      releaseScrollLock();
      // Restore focus to the trigger if it's still in the document.
      if (prevActive && prevActive.isConnected) prevActive.focus();
    };
    // Mount-once: focus capture/restore, scroll lock and stack membership must
    // not churn on parent re-renders. The keydown handler reads onClose via ref.
  }, []);

  // Portal the modal to document.body so it never lives inside a
  // parent <form>. Nested forms in the same DOM subtree cause the
  // inner form's submit to bubble up to the outer one — that was
  // reloading the app when the CommandPalette stepper's Next button
  // was clicked inside the Composer's form.
  if (typeof document === 'undefined') return <></>;
  return createPortal(
    <div
      className="moxxy-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        display: 'grid',
        placeItems: 'center',
        boxSizing: 'border-box',
        padding: 'var(--space-16)',
        overflow: 'hidden',
        zIndex: 1000,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="moxxy-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        tabIndex={-1}
        style={{
          width,
          maxWidth: '100%',
          maxHeight: 'calc(100dvh - var(--space-32, 32px))',
          minHeight: 0,
          boxSizing: 'border-box',
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border-strong)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--color-card-shadow)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          outline: 'none',
        }}
      >
        <header
          className="moxxy-modal__header"
          style={{
            minHeight: 'var(--frame-bar, 44px)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-12)',
            padding: '0 var(--space-12) 0 var(--space-16)',
            borderBottom: '1px solid var(--color-card-border)',
          }}
        >
          <h2
            id={titleId}
            style={{
              margin: 0,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 'var(--type-ui)',
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </h2>
          <IconButton aria-label="Close" onClick={onClose} size={26}>
            <Icon name="x" size={15} />
          </IconButton>
        </header>
        <div
          className="moxxy-modal__body"
          style={{
            minHeight: 0,
            overflowX: 'hidden',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            scrollbarGutter: 'stable',
            padding: 'var(--space-12) var(--space-16) var(--space-16)',
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  ) as JSX.Element;
}

export interface ModalFooterProps extends HTMLAttributes<HTMLElement> {
  /** `between` keeps a navigation action on the left and confirmations right. */
  readonly justify?: 'end' | 'between';
}

/** A single action-row treatment shared by every form dialog. */
export function ModalFooter({
  justify = 'end',
  className,
  style,
  children,
  ...rest
}: ModalFooterProps): JSX.Element {
  const merged: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: justify === 'between' ? 'space-between' : 'flex-end',
    gap: 'var(--space-8)',
    marginTop: 'var(--space-4)',
    paddingTop: 'var(--space-12)',
    borderTop: '1px solid var(--color-card-border)',
    ...style,
  };
  const classes = ['moxxy-modal__footer', className].filter(Boolean).join(' ');
  return (
    <footer className={classes} style={merged} {...rest}>
      {children}
    </footer>
  );
}

interface ConfirmProps {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmProps): JSX.Element {
  const messageId = useId();
  return (
    <Modal title={title} onClose={onCancel} describedById={messageId}>
      <p
        id={messageId}
        style={{
          margin: 0,
          fontSize: 'var(--type-row)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.55,
        }}
      >
        {message}
      </p>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
