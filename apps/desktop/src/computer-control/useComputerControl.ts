import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import { computerPanel, type ComputerPanelCommand, type ComputerScope, type ComputerSnapshots } from './panel-model';

/**
 * The control strip's state for one live turn: one read, then the runner's
 * pushed changes. A reply or a push for another turn can never drive this one.
 */
export function useComputerControl(scope:ComputerScope|null) {
  const key=scope ? JSON.stringify(scope) : null;
  const live=useRef(key);
  live.current=key;
  /** Counts pushes and commands, so a read that started earlier cannot overwrite newer state. */
  const epoch=useRef(0);
  const [data,setData]=useState<{key:string;response:ComputerSnapshots}|null>(null);
  const [busyKey,setBusyKey]=useState<string|null>(null);
  const [error,setError]=useState<{key:string;message:string}|null>(null);
  const workspaceId=scope?.workspaceId;
  useEffect(()=>{
    if (!key || !workspaceId) return;
    live.current=key;
    let disposed=false;
    // Subscribe before the read, so a change during the read is not missed.
    const unsubscribe=api().subscribe('computer.changed',(response)=>{
      if (disposed || response.workspaceId!==workspaceId) return;
      epoch.current++;
      setData({key,response});
    });
    const started=epoch.current;
    void api().invoke('computer.snapshot',{workspaceId}).then((response)=>{
      if (!disposed && live.current===key && started===epoch.current) setData({key,response});
    },()=>{
      // Absent/older services must not interfere with normal chat. The native
      // guardian remains independently available if IPC becomes unavailable.
      if (!disposed && live.current===key) setError({key,message:'Status unavailable. The independent Computer Use panel can still stop control.'});
    });
    return ()=>{
      disposed=true;
      unsubscribe();
      if (live.current===key) live.current=null;
    };
  },[key,workspaceId]);
  const view=scope && data?.key===key ? computerPanel(scope,data.response) : null;
  const command=async(action:ComputerPanelCommand)=>{
    if (!scope || !key || live.current!==key || !view) return;
    if ((action==='takeover' && !view.canTakeOver) || (action==='resume' && !view.canResume) || (action==='stop' && !view.canStop)) return;
    if (busyKey===key && action!=='stop') return;
    const sent=++epoch.current;
    setBusyKey(key); setError(null);
    try {
      await api().invoke('computer.control',{...scope,command:action});
    } catch {
      if (live.current===key && epoch.current===sent) setError({key,message:'Control command was not confirmed. Check the independent Computer Use panel.'});
    } finally {
      if (live.current===key) setBusyKey(current=>current===key ? null : current);
    }
  };
  return {view,busy:busyKey===key && key!==null,error:error?.key===key ? error.message : null,command};
}
