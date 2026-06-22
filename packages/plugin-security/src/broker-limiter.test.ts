import { describe, expect, it } from 'vitest';
import {
  BrokerOpLimiter,
  DEFAULT_MAX_INFLIGHT_BROKER_OPS,
} from './broker-limiter.js';

describe('BrokerOpLimiter', () => {
  it('admits up to the limit, then rejects the overflow', () => {
    const lim = new BrokerOpLimiter(3);
    expect(lim.limit).toBe(3);
    expect(lim.tryAcquire()).toBe(true);
    expect(lim.tryAcquire()).toBe(true);
    expect(lim.tryAcquire()).toBe(true);
    expect(lim.inflight).toBe(3);
    // At capacity: the 4th op is rejected back to the caller, not queued.
    expect(lim.tryAcquire()).toBe(false);
    expect(lim.inflight).toBe(3);
  });

  it('frees a slot on release so a later op can run', () => {
    const lim = new BrokerOpLimiter(1);
    expect(lim.tryAcquire()).toBe(true);
    expect(lim.tryAcquire()).toBe(false);
    lim.release();
    expect(lim.inflight).toBe(0);
    expect(lim.tryAcquire()).toBe(true);
  });

  it('never drives inflight negative on an extra release', () => {
    const lim = new BrokerOpLimiter(2);
    lim.release();
    lim.release();
    expect(lim.inflight).toBe(0);
    // The freed-but-never-acquired releases must not have inflated capacity.
    expect(lim.tryAcquire()).toBe(true);
    expect(lim.tryAcquire()).toBe(true);
    expect(lim.tryAcquire()).toBe(false);
  });

  it('defaults to the shared ceiling', () => {
    expect(new BrokerOpLimiter().limit).toBe(DEFAULT_MAX_INFLIGHT_BROKER_OPS);
    expect(new BrokerOpLimiter(undefined).limit).toBe(DEFAULT_MAX_INFLIGHT_BROKER_OPS);
  });

  it('clamps a non-finite or <1 max to a safe floor instead of disabling the guard', () => {
    // NaN / Infinity would otherwise make the comparison never reject (NaN) or
    // never cap (Infinity), defeating the flood guard; <1 would wedge every op.
    expect(new BrokerOpLimiter(Number.NaN).limit).toBe(DEFAULT_MAX_INFLIGHT_BROKER_OPS);
    expect(new BrokerOpLimiter(Number.POSITIVE_INFINITY).limit).toBe(
      DEFAULT_MAX_INFLIGHT_BROKER_OPS,
    );
    expect(new BrokerOpLimiter(0).limit).toBe(1);
    expect(new BrokerOpLimiter(-5).limit).toBe(1);
    // Fractional ceilings floor to an integer.
    expect(new BrokerOpLimiter(4.9).limit).toBe(4);
  });
});
