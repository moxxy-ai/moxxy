import { useEffect, useMemo, useState } from 'react';
import type { ClientSession } from '@moxxy/sdk';
import type { Picker } from './types.js';
import { withSessionReasoning } from './reasoning-picker.js';

export function useSessionPicker(session: ClientSession, picker: Picker, model?: string): Picker {
  const [revision, refresh] = useState(0);
  useEffect(() => session.onInfoChanged?.(() => refresh((n) => n + 1)), [session]);
  // Keep the highlighted row while Ink redraws the rest of the conversation.
  return useMemo(() => {
    if (!session.setReasoningEffort || (picker?.kind !== 'settings' && picker?.kind !== 'reasoning')) return picker;
    return withSessionReasoning(picker, session.getInfo(), model);
  }, [session, picker, model, revision]);
}
