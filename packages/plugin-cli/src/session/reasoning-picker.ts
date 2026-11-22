import {
  fitReasoningEffort,
  isReasoningEffort,
  reasoningEffortsOf,
  reasoningLevelsOf,
  type ReasoningEffort,
  type SessionInfo,
} from '@moxxy/sdk';
import type { ListPickerOption } from '../components/ListPicker.js';
import type { Picker } from './types.js';

type ReasoningMenu = Extract<Picker, { kind: 'settings' | 'reasoning' }>;
type ReasoningInfo = Pick<SessionInfo, 'activeProvider' | 'providers' | 'defaultModel' | 'reasoningEffort'>;

/** The adjustment a model selection needs, even when no turn follows it. */
export function modelSwitchEffort(info: ReasoningInfo, providerId: string, modelId: string): ReasoningEffort | undefined {
  const provider = info.providers.find(p => p.name === providerId);
  const model = provider?.models.find(m => m.id === modelId);
  if (!model?.supportsReasoning || !isReasoningEffort(info.reasoningEffort)) return undefined;
  const effort = fitReasoningEffort(info.reasoningEffort, reasoningEffortsOf(model));
  return effort === info.reasoningEffort ? undefined : effort;
}

/** Project both menus from the live session, including changes from another client while a menu is open. */
export function withSessionReasoning(picker: ReasoningMenu, info: ReasoningInfo, model?: string): ReasoningMenu {
  const provider = info.providers.find(p => p.name === info.activeProvider);
  const models = provider?.models ?? [];
  const modelId = model ?? info.defaultModel;
  const active = modelId ? models.find(m => m.id === modelId) : models[0];
  const levels = reasoningLevelsOf(active ? [active] : models);
  if (info.reasoningEffort === undefined || levels.length === 0) return picker;

  const current = info.reasoningEffort ?? 'off';
  if (picker.kind === 'settings') {
    const row: ListPickerOption = {
      id: 'session-reasoning', label: 'Model reasoning', description: 'Choose the effort for this conversation',
      badge: current, badgeColor: 'cyan',
    };
    return { ...picker, options: [row, ...picker.options] };
  }
  const choices = provider?.agentName ? levels : ['off', ...levels];
  return { ...picker, options: choices.map(id => ({
    id, label: id === 'ultra' ? 'Ultra (delegates to subagents)' : id, current: id === current,
  })) };
}
