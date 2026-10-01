import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyPreview, cursorPlace, hidePreview, isPreviewHidden, previewLabel, reloadPreviewHiddenFromStorage, showPreview, STOPPED_PREVIEW,
} from './preview-model';

const image = { mediaType: 'image/jpeg' as const, base64: 'abc', width: 640, height: 400 };

describe('applyPreview', () => {
  it('starts from the surface snapshot and follows frames and states', () => {
    const live = applyPreview(STOPPED_PREVIEW, { state: 'live', frame: { seq: 3, image } });
    expect(live).toEqual({ state: 'live', frame: { seq: 3, image } });
    const next = applyPreview(live, { type: 'frame', seq: 4, image: { ...image, base64: 'def' } });
    expect(next.frame?.image.base64).toBe('def');
    expect(applyPreview(next, { type: 'state', state: 'stale' })).toEqual({ state: 'stale', frame: next.frame });
    expect(applyPreview(next, { type: 'state', state: 'unavailable', reason: 'Screen Recording is not allowed' }))
      .toEqual({ state: 'unavailable', reason: 'Screen Recording is not allowed', frame: next.frame });
  });

  it('drops the picture when the turn stopped, so nothing of it stays on screen', () => {
    const live = applyPreview(STOPPED_PREVIEW, { state: 'live', frame: { seq: 1, image } });
    expect(applyPreview(live, { type: 'state', state: 'stopped' })).toEqual({ state: 'stopped' });
  });

  it('ignores an older frame and anything that is not a preview message', () => {
    const live = applyPreview(STOPPED_PREVIEW, { type: 'frame', seq: 5, image });
    expect(applyPreview(live, { type: 'frame', seq: 4, image: { ...image, base64: 'old' } })).toBe(live);
    for (const junk of [null, 'frame', { type: 'frame', seq: 6 }, { type: 'frame', seq: 6, image: { ...image, mediaType: 'text/html' } }, { type: 'state', state: 'dancing' }]) {
      expect(applyPreview(live, junk)).toBe(live);
    }
  });
});

describe('presentation', () => {
  it('names every state in words', () => {
    expect(previewLabel({ state: 'live' })).toBe('Live view');
    expect(previewLabel({ state: 'stale' })).toBe('View paused');
    expect(previewLabel({ state: 'stopped' })).toBe('No app in use');
    expect(previewLabel({ state: 'unavailable', reason: 'Screen Recording is not allowed' })).toBe('No view: Screen Recording is not allowed');
    expect(previewLabel({ state: 'unavailable' })).toBe('No view');
  });

  it('places the agent cursor as a share of the picture', () => {
    expect(cursorPlace({ phase: 'moving', x: 0.25, y: 0.5 })).toEqual({ left: '25%', top: '50%' });
  });
});

describe('hiding the preview', () => {
  beforeEach(() => { window.localStorage.clear(); reloadPreviewHiddenFromStorage(); });

  it('hides it for one conversation or for all, and remembers the choice', () => {
    expect(isPreviewHidden('ws-a')).toBe(false);
    hidePreview('conversation', 'ws-a');
    expect(isPreviewHidden('ws-a')).toBe(true);
    expect(isPreviewHidden('ws-b')).toBe(false);
    hidePreview('all', 'ws-a');
    expect(isPreviewHidden('ws-b')).toBe(true);
    reloadPreviewHiddenFromStorage();
    expect(isPreviewHidden('ws-b')).toBe(true);
    showPreview('ws-a');
    expect(isPreviewHidden('ws-a')).toBe(false);
    expect(isPreviewHidden('ws-b')).toBe(false);
    reloadPreviewHiddenFromStorage();
    expect(isPreviewHidden('ws-a')).toBe(false);
  });
});
