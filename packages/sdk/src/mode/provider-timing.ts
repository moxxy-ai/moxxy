import type { ProviderCallTiming } from '../events.js';

export function providerTiming(sample: {
  start:number; prepared:number; hooked:number; end:number;
  firstEvent:number|null; consumerMs:number; projectionMs:number;
}): ProviderCallTiming {
  const duration=(end:number,start:number) => Math.max(0,end-start);
  const streamMs=duration(sample.end,sample.hooked);
  const consumerMs=Math.min(streamMs,Math.max(0,sample.consumerMs));
  return {
    contextProjectionMs:sample.projectionMs,
    preparationMs:duration(sample.prepared,sample.start),
    hooksMs:duration(sample.hooked,sample.prepared),
    firstEventMs:sample.firstEvent===null ? null : duration(sample.firstEvent,sample.hooked),
    providerWaitMs:streamMs-consumerMs,
    consumerMs,
    totalMs:duration(sample.end,sample.start)+sample.projectionMs,
  };
}
