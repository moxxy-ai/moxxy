import { useSyncExternalStore } from 'react';
import type { ComputerCursor } from '@moxxy/sdk';
import { asVideoChunk } from './video-preview';

/** Mirrors the `computer-preview` surface of @moxxy/plugin-computer-control. */
export const COMPUTER_PREVIEW_SURFACE = 'computer-preview';
export interface PreviewImage { mediaType: 'image/jpeg'; base64: string; width: number; height: number }
export type PreviewState = 'live' | 'stale' | 'unavailable' | 'stopped';
/** A view shows the latest JPEG `frame`, or a `video` stream painted by the decoder (only its size is state). */
export interface PreviewView { state: PreviewState; reason?: string; frame?: { seq: number; image: PreviewImage }; video?: { width: number; height: number } }
export const STOPPED_PREVIEW: PreviewView = { state: 'stopped' };

const states: ReadonlySet<string> = new Set(['live', 'stale', 'unavailable', 'stopped']);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isSize = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 8192;

function asImage(value: unknown): PreviewImage | undefined {
  if (!isRecord(value) || value.mediaType !== 'image/jpeg' || typeof value.base64 !== 'string' || !isSize(value.width) || !isSize(value.height)) return undefined;
  return { mediaType: 'image/jpeg', base64: value.base64, width: value.width, height: value.height };
}

function asFrame(value: unknown): PreviewView['frame'] {
  if (!isRecord(value) || typeof value.seq !== 'number') return undefined;
  const image = asImage(value.image);
  return image ? { seq: value.seq, image } : undefined;
}

function withState(view: PreviewView, state: unknown, reason: unknown, frame: PreviewView['frame'], video?: PreviewView['video']): PreviewView {
  if (typeof state !== 'string' || !states.has(state)) return view;
  // A stopped turn leaves nothing of the app on screen.
  if (state === 'stopped') return STOPPED_PREVIEW;
  return { state: state as PreviewState, ...(typeof reason === 'string' ? { reason } : {}), ...(frame ? { frame } : {}), ...(video ? { video } : {}) };
}

/** Folds a surface snapshot or message into what the PiP shows; anything else leaves it unchanged. */
export function applyPreview(view: PreviewView, payload: unknown): PreviewView {
  if (!isRecord(payload)) return view;
  if (payload.type === 'frame') {
    const frame = asFrame(payload);
    if (!frame || (!view.video && frame.seq <= (view.frame?.seq ?? -1))) return view;
    // Pictures replace a video stream, and the other way round below.
    const { video: _video, ...rest } = view;
    return { ...rest, frame };
  }
  if (payload.type === 'chunk') {
    const chunk = asVideoChunk(payload);
    if (!chunk || (view.video?.width === chunk.width && view.video.height === chunk.height)) return view;
    const { frame: _frame, ...rest } = view;
    return { ...rest, video: { width: chunk.width, height: chunk.height } };
  }
  if (payload.type === 'state') return withState(view, payload.state, payload.reason, view.frame, view.video);
  return payload.type === undefined ? withState(view, payload.state, payload.reason, asFrame(payload.frame)) : view;
}

export function previewLabel(view: PreviewView): string {
  if (view.state === 'live') return 'Live view';
  if (view.state === 'stale') return 'View paused';
  if (view.state === 'stopped') return 'No app in use';
  return view.reason ? `No view: ${view.reason}` : 'No view';
}

export function cursorPlace(cursor: ComputerCursor): { left: string; top: string } {
  return { left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` };
}

// Whether the user wants the preview: renderer-only state kept in localStorage,
// shared by every chat surface through one module store.
const STORAGE_KEY = 'moxxy.computerPreviewHidden';
export type HideScope = 'conversation' | 'all';
interface Hidden { all: boolean; workspaces: ReadonlySet<string> }

function readStored(): Hidden {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!isRecord(parsed)) return { all: false, workspaces: new Set() };
    const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces.filter((id): id is string => typeof id === 'string') : [];
    return { all: parsed.all === true, workspaces: new Set(workspaces) };
  } catch {
    return { all: false, workspaces: new Set() };
  }
}

let hidden = readStored();
const listeners = new Set<() => void>();

function store(next: Hidden): void {
  hidden = next;
  try {
    if (!next.all && next.workspaces.size === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ all: next.all, workspaces: [...next.workspaces] }));
  } catch {
    // Persistence is best-effort; the in-memory choice still applies.
  }
  for (const listener of listeners) listener();
}

export function isPreviewHidden(workspaceId: string): boolean {
  return hidden.all || hidden.workspaces.has(workspaceId);
}

export function hidePreview(scope: HideScope, workspaceId: string): void {
  store(scope === 'all' ? { ...hidden, all: true } : { ...hidden, workspaces: new Set([...hidden.workspaces, workspaceId]) });
}

/** Showing it again in one conversation also lifts "hide in all". */
export function showPreview(workspaceId: string): void {
  store({ all: false, workspaces: new Set([...hidden.workspaces].filter((id) => id !== workspaceId)) });
}

export function usePreviewHidden(workspaceId: string): boolean {
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  return useSyncExternalStore(subscribe, () => isPreviewHidden(workspaceId), () => isPreviewHidden(workspaceId));
}

/** Test-only: the module store outlives a test; this re-reads localStorage. */
export function reloadPreviewHiddenFromStorage(): void {
  hidden = readStored();
  for (const listener of listeners) listener();
}
