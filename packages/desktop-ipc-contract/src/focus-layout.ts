/** Geometry shared by the Focus renderer and its native BrowserWindow host. */
export type FocusVerticalAnchor = 'center' | 'bottom';

export const FOCUS_PET_LAYOUT = Object.freeze({
  collapsedWidth: 84,
  voiceActiveCollapsedWidth: 136,
  collapsedHeight: 104,
  activeAvatarWidth: 72,
  activeHeight: 90,
  activeOverlap: 18,
});

export const FOCUS_PET_ACTIVE_EXTRA_WIDTH =
  FOCUS_PET_LAYOUT.activeAvatarWidth - FOCUS_PET_LAYOUT.activeOverlap;

export const FOCUS_PET_BUBBLE_LAYOUT = Object.freeze({
  width: 366,
  height: 190,
});

export const FOCUS_PET_RESTORE_LAYOUT = Object.freeze({
  width: FOCUS_PET_LAYOUT.collapsedWidth + 36,
  height: FOCUS_PET_LAYOUT.collapsedHeight,
});

export const FOCUS_PET_ACTIVE_RESTORE_LAYOUT = Object.freeze({
  height: FOCUS_PET_LAYOUT.activeHeight + 36,
});
