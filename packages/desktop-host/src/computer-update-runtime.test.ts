import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { probeInstalledComputerPackage } from './computer-update-runtime.js';

it('probes the installed package in a real process and rejects the previous tool set', async () => {
  const directory=await mkdtemp(join(tmpdir(),'moxxy-runtime-probe-'));
  try {
    await mkdir(join(directory,'dist'));
    await writeFile(join(directory,'package.json'),JSON.stringify({type:'module'}));
    const fixture=(tools:string[],platform:string) => `export default {
      tools:[${tools.map(name=>`{name:'${name}'}`).join(',')},{name:'computer_status',handler:async()=>({platform:'${platform}',ready:true,permissions:{accessibility:true,screenRecording:true},limitations:[]})}],
      hooks:{onShutdown:async()=>{}}
    };`;
    await writeFile(join(directory,'dist','index.js'),fixture(['computer_get_app_state'],'win32'));
    await expect(probeInstalledComputerPackage(directory)).resolves.toBeUndefined();
    // The previous tool set, and a helper that does not answer for Windows, are both refused.
    await writeFile(join(directory,'dist','index.js'),fixture(['computer_open'],'win32'));
    await expect(probeInstalledComputerPackage(directory)).rejects.toThrow('previous version retained');
    await writeFile(join(directory,'dist','index.js'),fixture(['computer_get_app_state'],'darwin'));
    await expect(probeInstalledComputerPackage(directory)).rejects.toThrow('previous version retained');
  } finally { await rm(directory,{recursive:true,force:true}); }
});
