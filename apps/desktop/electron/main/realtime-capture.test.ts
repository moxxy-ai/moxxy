import { describe, expect, it, vi } from 'vitest';
import { RealtimeCaptureController } from './realtime-capture';

describe('RealtimeCaptureController', () => {
  it('disables throttling only while Voice Mode owns realtime capture', () => {
    const setBackgroundThrottling = vi.fn();
    const target = { isDestroyed: () => false, setBackgroundThrottling };
    const controller = new RealtimeCaptureController();

    controller.attach(target);
    controller.setActive(true);
    controller.setActive(true);
    controller.setActive(false);

    expect(setBackgroundThrottling.mock.calls).toEqual([[true], [false], [true]]);
  });

  it('applies the active lease to a replacement renderer and resets after teardown', () => {
    const first = { isDestroyed: () => false, setBackgroundThrottling: vi.fn() };
    const second = { isDestroyed: () => false, setBackgroundThrottling: vi.fn() };
    const controller = new RealtimeCaptureController();

    controller.attach(first);
    controller.setActive(true);
    controller.detach(first);
    controller.attach(second);

    expect(second.setBackgroundThrottling).toHaveBeenLastCalledWith(false);

    controller.reset();
    expect(second.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
  });
});
