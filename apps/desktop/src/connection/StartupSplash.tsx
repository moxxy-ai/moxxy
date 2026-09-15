import type { ReactNode } from 'react';
import { Splash } from '@/Splash';
import { useStartupWait } from './useStartupWait';

export function StartupSplash({stage,message,delayMs,details}: {
  readonly stage: string;
  readonly message?: string;
  readonly delayMs?: number;
  readonly details?: ReactNode;
}): JSX.Element {
  const delayed=useStartupWait(stage,delayMs);
  return <Splash message={message}>
    {delayed && <div style={{maxWidth:520,width:'100%'}}>
      <p role="alert">This step is taking longer than expected. Moxxy is still waiting; no work has been stopped.</p>
      <p>Current stage: {message ?? stage}. If this started after an update, check the details before restarting the app.</p>
      {details}
    </div>}
  </Splash>;
}
