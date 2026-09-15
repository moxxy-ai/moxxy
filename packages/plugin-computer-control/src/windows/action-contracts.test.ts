import { expect, it } from 'vitest';
import { actionSchema, actionStatusSchema, actionResultSchema } from './contracts.js';

it('only permits explicit observed UIA actions and bounded receipt waiting', () => {
  const target={windowId:'w',observationId:'o',elementId:'e'};
  expect(actionSchema.safeParse({...target,action:'toggle'}).success).toBe(true);
  expect(actionSchema.safeParse({...target,action:'eval'}).success).toBe(false);
  expect(actionSchema.safeParse({...target,action:'invoke',fallback:'click'}).success).toBe(false);
  expect(actionStatusSchema.parse({actionId:'a'})).toEqual({actionId:'a',waitMs:0});
  expect(actionStatusSchema.safeParse({actionId:'a',waitMs:1001}).success).toBe(false);
  expect(actionResultSchema.safeParse({actionId:'a',status:'pending',verificationRequired:true}).success).toBe(true);
  expect(actionResultSchema.safeParse({actionId:'a',status:'pending',verificationRequired:false}).success).toBe(false);
});
