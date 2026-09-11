import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { acquireComputerMaintenance } from '@moxxy/plugin-computer-control/maintenance';
import {
  activateComputerUpdate, discardComputerUpdate, prepareComputerUpdate, recoverComputerUpdates,
  isBundledComputerCurrent,
  type PreparedComputerUpdate,
} from './computer-update.js';

const probe = `import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const {default:plugin}=await import(pathToFileURL(path.join(process.argv[1],'dist','index.js')).href);
const status=plugin.tools.find(t=>t.name==='computer_status');
if(!status || !plugin.tools.some(t=>t.name==='computer_open')) throw Error('Computer Use tools missing');
const context={sessionId:randomUUID(),turnId:randomUUID(),signal:new AbortController().signal};
try {
  const result=await status.handler({},context);
  if(result.protocolVersion!==2 || result.platform!=='win32' || result.architecture!=='x64') throw Error('Computer Use helper mismatch');
  console.log('MOXXY_COMPUTER_UPDATE_VERIFIED');
} finally { await plugin.hooks.onShutdown(context); }
`;

/** Isolated import avoids retaining old modules/DLLs in the desktop process. */
export async function probeInstalledComputerPackage(directory:string):Promise<void> {
  const child=spawn(process.execPath,['--input-type=module','-e',probe,directory],{
    shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},
  });
  await new Promise<void>((resolve,reject)=>{
    let output='',bytes=0,expired=false;
    const timer=setTimeout(()=>{expired=true;child.kill();},15000);
    const drain=(chunk:Buffer,stdout:boolean)=>{
      bytes+=chunk.length;
      if (bytes>64000) { expired=true;child.kill();return; }
      if (stdout) output+=chunk.toString('utf8');
    };
    child.stdout.on('data',(chunk:Buffer)=>drain(chunk,true));
    child.stderr.on('data',(chunk:Buffer)=>drain(chunk,false));
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Computer Use verification process could not start'));});
    child.once('close',(code)=>{
      clearTimeout(timer);
      if (!expired && code===0 && output.trim()==='MOXXY_COMPUTER_UPDATE_VERIFIED') resolve();
      else reject(new Error('Installed Computer Use failed its isolated runtime/helper verification; previous version retained'));
    });
  });
}

export interface ComputerUpdateOffer {
  readonly installedHash:string|null;
  readonly replacementHash:string;
  readonly backupPath:string;
  readonly localChanges:PreparedComputerUpdate['localChanges'];
}

/** Called only by the packaged Windows startup, before the runner pool spawns. */
export async function offerBundledComputerUpdate(options:{
  resourcesPath:string; moxxyHome:string; freshInstall:boolean;
  confirm:(offer:ComputerUpdateOffer)=>Promise<boolean>;
  log?:(message:string)=>void;
}):Promise<'current'|'declined'|'updated'> {
  if (await isBundledComputerCurrent(options)) return 'current';
  const executable=path.join(options.resourcesPath,'plugins-seed','node_modules','@moxxy','plugin-computer-control','bin','win32-x64','moxxy-computer.exe');
  const lease=await acquireComputerMaintenance(executable);
  let update:PreparedComputerUpdate|undefined;
  try {
    await recoverComputerUpdates(options.moxxyHome);
    update=await prepareComputerUpdate(options);
    if (update.installedHash===update.stagedHash) return 'current';
    if (!options.freshInstall && !await options.confirm({
      installedHash:update.installedHash,replacementHash:update.stagedHash,backupPath:update.backupPath,localChanges:update.localChanges,
    })) return 'declined';
    lease.assertHeld();
    const result=await activateComputerUpdate(update,update.installedHash,async(directory)=>{
      lease.assertHeld();
      await probeInstalledComputerPackage(directory);
      lease.assertHeld();
    });
    options.log?.(`Computer Use extension updated; previous version: ${result.backupPath}`);
    return 'updated';
  } finally {
    try { if (update) await discardComputerUpdate(update); }
    finally { await lease.close(); }
  }
}
