// ---------- Notices about work that finished in the background ------------

/** Where clicking a notice takes the person: a section of a destination. */
export interface AppNoticeTarget {
  readonly destination: 'settings';
  /** The section id, as Settings names its tabs (`voice`). */
  readonly section: string;
}

/**
 * Something the host finished, or failed at, while the person may be anywhere:
 * a model download, a plugin set up. The renderer shows it as a toast while the
 * app is in front and as a system notification while it is in the background.
 */
export interface AppNotice {
  /** Stable per kind of notice; a newer notice with the same id replaces the older. */
  readonly id: string;
  readonly tone: 'success' | 'error' | 'info';
  readonly title: string;
  readonly body?: string;
  readonly target?: AppNoticeTarget;
}
