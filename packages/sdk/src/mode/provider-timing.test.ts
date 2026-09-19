import { expect, it } from 'vitest';
import { providerTiming } from './provider-timing.js';

it('separates preparation, hooks, provider waiting and local stream handling without double counting', () => {
  expect(providerTiming({start:100,prepared:110,hooked:140,end:240,firstEvent:180,consumerMs:25,projectionMs:7})).toEqual({
    contextProjectionMs:7,preparationMs:10,hooksMs:30,firstEventMs:40,
    providerWaitMs:75,consumerMs:25,totalMs:147,
  });
});

it('keeps a missing first event distinct from an immediate response', () => {
  const timing=providerTiming({start:0,prepared:0,hooked:1,end:5,firstEvent:null,consumerMs:0,projectionMs:0});
  expect(timing.firstEventMs).toBeNull();
  expect(timing.providerWaitMs).toBe(4);
  expect(timing.totalMs).toBe(5);
});
