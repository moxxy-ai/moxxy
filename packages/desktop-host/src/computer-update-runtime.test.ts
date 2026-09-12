import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { probeInstalledComputerPackage } from './computer-update-runtime.js';

it('probes the installed package in a real process and rejects the previous native protocol', async () => {
  const directory=await mkdtemp(join(tmpdir(),'moxxy-runtime-probe-'));
  try {
    await mkdir(join(directory,'dist'));
    await writeFile(join(directory,'package.json'),JSON.stringify({type:'module'}));
    const fixture=(version:number) => `export default {
      tools:[{name:'computer_open'},{name:'computer_status',handler:async()=>({protocolVersion:${version},platform:'win32',architecture:'x64'})}],
      hooks:{onShutdown:async()=>{}}
    };`;
    await writeFile(join(directory,'dist','index.js'),fixture(3));
    await expect(probeInstalledComputerPackage(directory)).resolves.toBeUndefined();
    await writeFile(join(directory,'dist','index.js'),fixture(2));
    await expect(probeInstalledComputerPackage(directory)).rejects.toThrow('previous version retained');
  } finally { await rm(directory,{recursive:true,force:true}); }
});
