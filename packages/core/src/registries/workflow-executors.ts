import type { WorkflowExecutorDef } from '@moxxy/sdk';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * Registry of swappable workflow-execution strategies. Register throws on
 * duplicate, auto-activates the first registration (so a session always has
 * an executor once `@moxxy/plugin-workflows` loads its default `dag`), and
 * `unregister` clears the active slot rather than silently picking a
 * successor. See {@link ActiveDefRegistry}.
 */
export class WorkflowExecutorRegistry extends ActiveDefRegistry<WorkflowExecutorDef> {
  constructor() {
    super({ noun: 'Workflow executor' });
  }
}
