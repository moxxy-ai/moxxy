import { useRef, useState } from 'react';

export function useWorkflowDelete(name: string, remove: (name: string) => Promise<boolean>) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  return {
    open, pending, error,
    request: () => { setError(null); setOpen(true); },
    cancel: () => { if (!busy.current) setOpen(false); },
    confirm: async () => {
      if (busy.current) return;
      busy.current = true; setPending(true); setError(null);
      try {
        if (await remove(name)) setOpen(false);
        else setError('Could not delete the workflow. Check the error in Automations.');
      } catch { setError('Could not delete the workflow. Try again.'); }
      finally { busy.current = false; setPending(false); }
    },
  };
}
