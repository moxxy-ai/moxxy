import type { EventStoreDef } from '@moxxy/sdk';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * The single-active EventStore registry (storage backend behind the event log).
 * Core seeds the JSONL default as a protected floor; uses throw-on-duplicate
 * `register` (NOT override) so a discovered plugin's store is added but never
 * shadows the floor — the user must `setActive` it explicitly. A removed
 * non-floor store reverts to the JSONL floor (never null).
 */
export class EventStoreRegistry extends ActiveDefRegistry<EventStoreDef> {
  constructor() {
    super({ noun: 'EventStore' });
  }
}
