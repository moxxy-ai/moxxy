import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { seedPluginsFromResources } from '../../../packages/desktop-host/dist/seed-plugins.js';
import { offerBundledComputerUpdate } from '../../../packages/desktop-host/dist/computer-update-runtime.js';
import { connectRemoteSession } from '../../../packages/runner/dist/index.js';

assert.equal(process.platform,'win32');
const resourcesPath=process.argv[2];
assert.ok(resourcesPath,'Expected installed resources');
const home=await mkdtemp(path.join(tmpdir(),'moxxy-cu-upgrade-'));
let runner, remote;
try {
  await seedPluginsFromResources({resourcesPath,moxxyHome:home});
  const target=path.join(home,'plugins','node_modules','@moxxy','plugin-computer-control');
  const sdk=path.join(home,'plugins','node_modules','@moxxy','sdk','dist','index.js');
  const sdkBytes=await readFile(sdk);
  const incompatibleSdk='export const incompatibleSharedSdk = true;';
  await writeFile(sdk,incompatibleSdk);
  await writeFile(path.join(target,'local-edit.txt'),'keep this in the backup');
  await writeFile(path.join(home,'saved-chat.txt'),'unchanged chat fixture');
  let confirmations=0, backup;
  const options={resourcesPath,moxxyHome:home,freshInstall:false,confirm:async offer=>{
    confirmations++;backup=offer.backupPath;return true;
  }};
  assert.equal(await offerBundledComputerUpdate(options),'updated');
  assert.equal(confirmations,1);
  assert.equal(await readFile(path.join(backup,'local-edit.txt'),'utf8'),'keep this in the backup');
  assert.equal(await readFile(sdk,'utf8'),incompatibleSdk,'Upgrade changed another package');
  assert.equal(await readFile(path.join(home,'saved-chat.txt'),'utf8'),'unchanged chat fixture');
  assert.equal(await offerBundledComputerUpdate({...options,confirm:async()=>{throw Error('Identical package should not prompt');}}),'current');
  await writeFile(path.join(target,'another-local-edit.txt'),'do not replace without consent');
  assert.equal(await offerBundledComputerUpdate({...options,confirm:async()=>false}),'declined');
  assert.equal(await readFile(path.join(target,'another-local-edit.txt'),'utf8'),'do not replace without consent');
  // Restore the deliberately incompatible shared-SDK fixture before checking
  // ordinary runner discovery. Computer Use already verified its private SDK.
  await writeFile(sdk,sdkBytes);
  const socketPath='\\\\.\\pipe\\moxxy-cu-update-'+randomUUID();
  runner=spawn(process.execPath,[path.join(resourcesPath,'moxxy-cli','dist','bin.js'),'serve'],{
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',MOXXY_HOME:home,MOXXY_RUNNER_SOCKET:socketPath,MOXXY_VAULT_PASSPHRASE:'isolated-computer-update-test'},
    stdio:['ignore','pipe','pipe'],windowsHide:true,
  });
  runner.stdout.resume();runner.stderr.resume();
  remote=await connectRemoteSession({socketPath,connectRetries:25});
  assert.ok(remote.getInfo().tools.some(tool=>tool.name==='computer_open'),'Runner did not load upgraded Computer Use');
  assert.deepEqual(await remote.computerControl.snapshot(),[]);
  assert.deepEqual(await remote.workflows.approvals.list(),[], 'Installed runner did not expose its durable workflow approval service');
  console.log('Computer Use offline upgrade, private SDK, consent, backup and actual runner discovery passed');
} finally {
  if (remote) await remote.close();
  if (runner && runner.exitCode===null) {
    runner.kill();
    await new Promise(resolve=>runner.once('close',resolve));
  }
  await rm(home,{recursive:true,force:true});
}
