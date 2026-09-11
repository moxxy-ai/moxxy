import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import { computerPanel, type ComputerScope, type ComputerSnapshots } from './panel-model';

/** Only a live Windows turn is polled; late replies cannot control another run. */
export function useComputerControl(scope:ComputerScope|null) {
  const key=scope ? JSON.stringify(scope) : null;
  const live=useRef(key);
  live.current=key;
  const commandEpoch=useRef(0);
  const [data,setData]=useState<{key:string;response:ComputerSnapshots}|null>(null);
  const [busyKey,setBusyKey]=useState<string|null>(null);
  const [error,setError]=useState<{key:string;message:string}|null>(null);
  const workspaceId=scope?.workspaceId;
  useEffect(()=>{
    if (!key || !workspaceId) return;
    live.current=key;
    let disposed=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const refresh=async()=>{
      const epoch=commandEpoch.current;
      try {
        const response=await api().invoke('computer.snapshot',{workspaceId});
        if (!disposed && live.current===key && epoch===commandEpoch.current) setData({key,response});
      } catch {
        // Absent/older services must not interfere with normal chat. The native
        // guardian remains independently available if IPC becomes unavailable.
        if (!disposed && live.current===key) setError({key,message:'Status unavailable. The independent Computer Use panel can still stop control.'});
      } finally {
        if (!disposed) timer=setTimeout(()=>void refresh(),1000);
      }
    };
    void refresh();
    return ()=>{
      disposed=true;
      if (timer) clearTimeout(timer);
      if (live.current===key) live.current=null;
    };
  },[key,workspaceId]);
  const view=scope && data?.key===key ? computerPanel(scope,data.response) : null;
  const command=async(action:'pause'|'resume'|'stop')=>{
    if (!scope || !key || live.current!==key || !view) return;
    if ((action==='pause' && !view.canPause) || (action==='resume' && !view.canResume) || (action==='stop' && !view.canStop)) return;
    if (busyKey===key && action!=='stop') return;
    const epoch=++commandEpoch.current;
    setBusyKey(key); setError(null);
    try {
      await api().invoke('computer.control',{...scope,command:action});
      const response=await api().invoke('computer.snapshot',{workspaceId:scope.workspaceId});
      if (live.current===key && commandEpoch.current===epoch) setData({key,response});
    } catch {
      if (live.current===key && commandEpoch.current===epoch) setError({key,message:'Control command was not confirmed. Check the independent Computer Use panel.'});
    } finally {
      if (live.current===key && commandEpoch.current===epoch) setBusyKey(null);
    }
  };
  return {view,busy:busyKey===key && key!==null,error:error?.key===key ? error.message : null,command};
}
