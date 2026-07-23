export interface RealtimeCaptureTarget {
  isDestroyed(): boolean;
  setBackgroundThrottling(allowed: boolean): void;
}

/** Keeps Chromium timers realtime only while the main renderer owns Voice Mode. */
export class RealtimeCaptureController {
  private target: RealtimeCaptureTarget | null = null;
  private active = false;

  attach(target: RealtimeCaptureTarget): void {
    this.target = target;
    this.apply();
  }

  detach(target: RealtimeCaptureTarget): void {
    if (this.target !== target) return;
    this.target = null;
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.apply();
  }

  reset(): void {
    this.active = false;
    this.apply();
  }

  private apply(): void {
    if (!this.target || this.target.isDestroyed()) return;
    this.target.setBackgroundThrottling(!this.active);
  }
}
