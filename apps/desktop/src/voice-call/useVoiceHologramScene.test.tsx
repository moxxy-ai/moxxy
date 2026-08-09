import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useVoiceHologramScene } from './useVoiceHologramScene';

/**
 * The scene is painted once and then left alone, so what matters is how often
 * the effect that paints it runs. Its `occupiedSlots` prop arrives as a freshly
 * mapped array on every render of the voice surface — and during a streaming
 * turn that is every delta. Keying the effect on the array itself rebuilt the
 * 2,600-particle field and repainted the canvas, shadow bloom included, on each
 * one; keying it on the CONTENT does not.
 */
function Harness({ slots, tick }: { readonly slots: ReadonlyArray<number>; readonly tick: number }) {
  const canvasRef = useVoiceHologramScene({ phase: 'listening', occupiedSlots: slots });
  return <canvas ref={canvasRef} data-tick={tick} />;
}

describe('useVoiceHologramScene', () => {
  it('does not re-run its paint effect when the caller re-renders with equal slots', () => {
    const getContext = vi.fn(() => null);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      getContext as unknown as HTMLCanvasElement['getContext'],
    );

    // Every render passes a NEW array with the SAME contents, exactly as
    // `orbit.items.map(...)` does upstream.
    const { rerender } = render(<Harness slots={[0, 1]} tick={0} />);
    const afterMount = getContext.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    for (let tick = 1; tick <= 5; tick += 1) rerender(<Harness slots={[0, 1]} tick={tick} />);
    expect(getContext.mock.calls.length).toBe(afterMount);

    // A real change to the running operations still repaints.
    rerender(<Harness slots={[0, 1, 2]} tick={6} />);
    expect(getContext.mock.calls.length).toBeGreaterThan(afterMount);

    vi.restoreAllMocks();
  });
});
