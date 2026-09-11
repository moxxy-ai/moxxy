import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { prepareComputerUpdate, activateComputerUpdate, computerTreeHash, recoverComputerUpdates, isBundledComputerCurrent } from './computer-update.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, {recursive:true,force:true}))); });
async function fixture(code = 'export const ready = true;') {
  const root = await mkdtemp(join(tmpdir(), 'moxxy-computer-update-')); roots.push(root);
  const resources = join(root, 'resources'); const home = join(root, 'home');
  const source = join(resources,'plugins-seed','node_modules','@moxxy','plugin-computer-control');
  const target = join(home,'plugins','node_modules','@moxxy','plugin-computer-control');
  for (const dir of [source,target]) await mkdir(join(dir,'dist'),{recursive:true});
  await writeFile(join(source,'package.json'), JSON.stringify({name:'@moxxy/plugin-computer-control',version:'1.0.0',type:'module',dependencies:{'@moxxy/sdk':'1.0.0'}}));
  await writeFile(join(source,'dist','index.js'),code);
  const sdk=join(resources,'plugins-seed','node_modules','@moxxy','sdk');
  await mkdir(sdk,{recursive:true});
  await writeFile(join(sdk,'package.json'),JSON.stringify({name:'@moxxy/sdk',version:'1.0.0',type:'module',exports:'./index.js'}));
  await writeFile(join(sdk,'index.js'),'export const revision = "bundled";');
  await writeFile(join(target,'dist','index.js'),'old user extension');
  await writeFile(join(home,'vault.json'),'preserve credentials');
  return {resourcesPath:resources,moxxyHome:home,target};
}

it('stages bundled dependency closure offline and replaces only the approved plugin', async () => {
  const options=await fixture('export { revision } from "@moxxy/sdk";');
  const before=await computerTreeHash(options.target);
  const update=await prepareComputerUpdate(options);
  expect(await computerTreeHash(options.target)).toBe(before);
  expect(await readFile(join(update.stagedPath,'node_modules','@moxxy','sdk','index.js'),'utf8')).toContain('bundled');
  const result=await activateComputerUpdate(update, before, async (directory) => {
    const loaded=await import(pathToFileURL(join(directory,'dist','index.js')).href);
    expect(loaded.revision).toBe('bundled');
  });
  expect(await readFile(join(result.backupPath,'dist','index.js'),'utf8')).toBe('old user extension');
  expect(await readFile(join(options.moxxyHome,'vault.json'),'utf8')).toBe('preserve credentials');
});

it('refuses changed user files or changed staging bytes before replacing anything', async () => {
  const options=await fixture(); const update=await prepareComputerUpdate(options);
  const approved=await computerTreeHash(options.target);
  await writeFile(join(options.target,'dist','index.js'),'manual edit after approval');
  await expect(activateComputerUpdate(update,approved,async()=>{})).rejects.toThrow(/changed/);
  expect(await readFile(join(options.target,'dist','index.js'),'utf8')).toBe('manual edit after approval');
  await writeFile(join(update.stagedPath,'dist','index.js'),'changed staging');
  await expect(activateComputerUpdate(update,await computerTreeHash(options.target),async()=>{})).rejects.toThrow(/changed/);
});

it('restores the original extension when the actual new JavaScript cannot load', async () => {
  const options=await fixture('this is not valid JavaScript !!!');
  const update=await prepareComputerUpdate(options);
  await expect(activateComputerUpdate(update,await computerTreeHash(options.target),async(directory)=>{
    await import(pathToFileURL(join(directory,'dist','index.js')).href);
  })).rejects.toThrow();
  expect(await readFile(join(options.target,'dist','index.js'),'utf8')).toBe('old user extension');
});

it('recovers an interrupted activation from its bounded journal without touching other data', async () => {
  const options=await fixture(); const update=await prepareComputerUpdate(options);
  await writeFile(join(update.transactionPath,'transaction.json'),JSON.stringify({schemaVersion:1,phase:'prepared',previous:update.installedHash,staged:update.stagedHash}));
  await rename(update.targetPath,update.backupPath);
  await rename(update.stagedPath,update.targetPath);
  expect(await recoverComputerUpdates(options.moxxyHome)).toEqual([update.transactionPath]);
  expect(await readFile(join(options.target,'dist','index.js'),'utf8')).toBe('old user extension');
  expect(await readFile(join(options.moxxyHome,'vault.json'),'utf8')).toBe('preserve credentials');
});

it('rejects a profile directory redirected through a symlink', async () => {
  const options=await fixture();
  const scope=join(options.moxxyHome,'plugins','node_modules','@moxxy');
  const elsewhere=join(options.moxxyHome,'moved-scope');
  await rename(scope,elsewhere);
  await symlink(elsewhere,scope,process.platform === 'win32' ? 'junction' : 'dir');
  await expect(prepareComputerUpdate(options)).rejects.toThrow(/regular directory/);
  expect(await readFile(join(elsewhere,'plugin-computer-control','dist','index.js'),'utf8')).toBe('old user extension');
});

it('updates only the Computer Use npm pin and lock subtree so later installs cannot restore its old version', async () => {
  const options=await fixture(); const plugins=join(options.moxxyHome,'plugins');
  const dependencies={'@moxxy/plugin-computer-control':'0.1.0',unrelated:'7.0.0'};
  await writeFile(join(plugins,'package.json'),JSON.stringify({name:'user-plugins',dependencies}));
  await writeFile(join(plugins,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{
    '':{dependencies},'node_modules/unrelated':{version:'7.0.0',integrity:'preserve'},
    'node_modules/@moxxy/plugin-computer-control':{version:'0.1.0',resolved:'https://old.invalid/pkg.tgz'},
  }}));
  const update=await prepareComputerUpdate(options);
  await activateComputerUpdate(update,update.installedHash,async(directory)=>{await import(pathToFileURL(join(directory,'dist','index.js')).href);});
  const root=JSON.parse(await readFile(join(plugins,'package.json'),'utf8'));
  const lock=JSON.parse(await readFile(join(plugins,'package-lock.json'),'utf8'));
  expect(root.dependencies).toEqual({'@moxxy/plugin-computer-control':'1.0.0',unrelated:'7.0.0'});
  expect(lock.packages['node_modules/@moxxy/plugin-computer-control'].version).toBe('1.0.0');
  expect(lock.packages['node_modules/@moxxy/plugin-computer-control'].resolved).toBeUndefined();
  expect(lock.packages['node_modules/@moxxy/plugin-computer-control/node_modules/@moxxy/sdk'].version).toBe('1.0.0');
  expect(lock.packages['node_modules/unrelated']).toEqual({version:'7.0.0',integrity:'preserve'});
});

it('distinguishes an untracked legacy plugin from modifications to a verified managed copy', async () => {
  const options=await fixture();
  const initial=await prepareComputerUpdate(options);
  expect(initial.localChanges).toBe('untracked');
  await activateComputerUpdate(initial,initial.installedHash,async(directory)=>{await import(pathToFileURL(join(directory,'dist','index.js')).href);});
  expect((await prepareComputerUpdate(options)).localChanges).toBe('unchanged');
  await writeFile(join(options.target,'local-customization.txt'),'user owns this');
  expect((await prepareComputerUpdate(options)).localChanges).toBe('changed');
});

it('recognizes an unchanged managed package without staging another copy, including source dependency changes', async () => {
  const options=await fixture();
  expect(await isBundledComputerCurrent(options)).toBe(false);
  const update=await prepareComputerUpdate(options);
  await activateComputerUpdate(update,update.installedHash,async(directory)=>{await import(pathToFileURL(join(directory,'dist','index.js')).href);});
  const before=await computerTreeHash(join(options.moxxyHome,'desktop'));
  expect(await isBundledComputerCurrent(options)).toBe(true);
  expect(await computerTreeHash(join(options.moxxyHome,'desktop'))).toBe(before);
  await writeFile(join(options.resourcesPath,'plugins-seed','node_modules','@moxxy','sdk','index.js'),'export const revision="new code, same version";');
  expect(await isBundledComputerCurrent(options)).toBe(false);
});
