import { useMemo } from 'react';
import { turnComputerUse } from '@moxxy/chat-model';
import type { MoxxyEvent } from '@moxxy/sdk';
import { agentComputerPanel, type ComputerPanelView } from './panel-model';

/** The strip for an agent using the computer with its own tools in the running turn; null otherwise. */
export function useAgentComputer(events:ReadonlyArray<MoxxyEvent>, running:boolean, agentName:string|undefined):ComputerPanelView|null {
  return useMemo(()=>running ? agentComputerPanel(turnComputerUse(events),agentName) : null,[events,running,agentName]);
}
