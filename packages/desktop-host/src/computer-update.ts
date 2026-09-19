import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { z } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';
import { readBoundedFile } from './bounded-read.js';
import { applyComputerLedgers, computerLedgerSchema, prepareComputerLedgers, type ComputerLedger } from './computer-update-ledger.js';

const pluginName = '@moxxy/plugin-computer-control';
const managedPackageSchema = z.enum([pluginName, '@moxxy/plugin-provider-openai', '@moxxy/plugin-provider-openai-codex']);
export type ManagedPackage = z.infer<typeof managedPackageSchema>;
interface UpdateOptions { resourcesPath: string; moxxyHome: string; plugin?: ManagedPackage }
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.object({
  name: z.string().regex(packageName), version: z.string().min(1).max(100),
  dependencies: z.record(z.string(),z.string()).optional(),
  optionalDependencies: z.record(z.string(),z.string()).optional(),
  peerDependencies: z.record(z.string(),z.string()).optional(),
  peerDependenciesMeta: z.record(z.string(),z.object({optional:z.boolean().optional()})).optional(),
}).passthrough();
const journalSchema = z.object({
  schemaVersion:z.literal(1), phase:z.enum(['prepared','activated','verified','rolled_back']),
  previous:digest.nullable(), staged:digest,
  source:digest.optional(),
  ledgers:z.array(computerLedgerSchema).max(2).optional(),
}).strict();
type Journal = z.infer<typeof journalSchema>;

export interface PreparedComputerUpdate {
  readonly plugin: ManagedPackage;
  readonly targetPath: string;
  readonly stagedPath: string;
  readonly backupPath: string;
  readonly transactionPath: string;
  readonly moxxyHome: string;
  readonly installedHash: string | null;
  readonly stagedHash: string;
  readonly sourceHash: string;
  readonly localChanges: 'untracked' | 'unchanged' | 'changed';
}
const prepared = new WeakSet<PreparedComputerUpdate>();
const tails = new Map<string, Promise<unknown>>();

function targetPath(home: string, plugin: ManagedPackage = pluginName): string {
  return path.join(home,'plugins','node_modules',managedPackageSchema.parse(plugin));
}
function updatesPath(home: string, plugin: ManagedPackage = pluginName): string {
  return plugin === pluginName ? path.join(home,'desktop','computer-updates') : path.join(home,'desktop','provider-updates',managedPackageSchema.parse(plugin).slice('@moxxy/'.length));
}
async function journals(home:string, plugin: ManagedPackage = pluginName):Promise<Array<{directory:string;file:string;record:Journal}>> {
  const root=updatesPath(home, plugin);
  await assertOwnedParents(home,root);
  if (!await exists(root)) return [];
  const names=await fs.readdir(root);
  if (names.length>1000) throw new Error('Computer Use recovery history exceeds safety limit');
  const result:Array<{directory:string;file:string;record:Journal}>=[];
  for (const name of names.sort()) {
    if (!/^update-[a-zA-Z0-9]{6}$/.test(name)) continue;
    const directory=path.join(root,name),file=path.join(directory,'transaction.json');
    await assertOwnedParents(home,directory);
    if (!await exists(file)) continue;
    const bytes=await readBoundedFile(file,4096,'Invalid Computer Use recovery journal');
    result.push({directory,file,record:journalSchema.parse(JSON.parse(bytes.toString('utf8')))});
  }
  return result;
}
async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Regular files only: never follow user-scope symlinks into unrelated data. */
export async function computerTreeHash(directory: string): Promise<string | null> {
  if (!await exists(directory)) return null;
  let bytes = 0, files = 0;
  const records: Array<[string,string]> = [];
  async function walk(file: string, relative: string): Promise<void> {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Computer Use update refuses symbolic links');
    if (stat.isDirectory()) {
      records.push([relative+'/', 'directory']);
      const names = (await fs.readdir(file)).sort();
      for (const name of names) await walk(path.join(file,name), relative ? relative+'/'+name : name);
    } else {
      if (!stat.isFile() || ++files > 20000) throw new Error('Computer Use package exceeds update limits');
      const content=await readBoundedFile(file,512_000_000-bytes,'Computer Use package exceeds update limits');
      bytes += content.length;
      records.push([relative,createHash('sha256').update(content).digest('hex')]);
    }
  }
  await walk(directory,'');
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

async function assertOwnedParents(home: string, target: string): Promise<void> {
  let current=target;
  for (;;) {
    if (await exists(current)) {
      const stat=await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Computer Use update target is not a regular directory');
    }
    if (current === home) return;
    const parent=path.dirname(current);
    if (parent === current) throw new Error('Computer Use update escaped its profile');
    current=parent;
  }
}

async function manifest(directory: string) {
  const file=path.join(directory,'package.json');
  const bytes=await readBoundedFile(file,512000,'Invalid bundled package manifest');
  return manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
}

/** Resolve only within the installer seed; no PATH, registry or npm access. */
async function dependencySource(from: string, seed: string, name: string): Promise<string|null> {
  if (!packageName.test(name)) throw new Error('Invalid bundled dependency name');
  let current=from;
  for (;;) {
    const candidate=path.join(current,'node_modules',name);
    if (await exists(candidate)) return candidate;
    if (current === seed) break;
    const parent=path.dirname(current);
    if (parent === current || path.relative(seed,parent).startsWith('..')) break;
    current=parent;
  }
  return null;
}

async function packageDependencies(from:string,seed:string):Promise<Array<{name:string;source:string}>> {
  const pkg=await manifest(from), metadata=pkg.peerDependenciesMeta ?? {};
  const peers=Object.keys(pkg.peerDependencies ?? {}).filter(name=>!metadata[name]?.optional);
  const optional=pkg.optionalDependencies ?? {};
  const required=new Set([...Object.keys(pkg.dependencies ?? {}).filter(name=>!(name in optional)),...peers]);
  const names=new Set([...required,...Object.keys(optional),...Object.keys(pkg.peerDependencies ?? {})]);
  const result:Array<{name:string;source:string}>=[];
  for (const name of [...names].sort()) {
    const source=await dependencySource(from,seed,name);
    if (!source) {
      if (required.has(name)) throw new Error(`Bundled Computer Use dependency missing: ${name}`);
      continue;
    }
    if ((await manifest(source)).name !== name) throw new Error('Bundled dependency identity mismatch');
    result.push({name,source});
  }
  return result;
}

async function bundleFingerprint(resourcesPath:string, plugin: ManagedPackage = pluginName):Promise<string> {
  const seed=path.join(path.resolve(resourcesPath),'plugins-seed');
  const seen=new Set<string>(), records:unknown[]=[];
  const relative=(file:string)=>path.relative(seed,file).split(path.sep).join('/');
  async function visit(directory:string):Promise<void> {
    if (seen.has(directory)) return;
    seen.add(directory);
    if (seen.size>64) throw new Error('Computer Use bundle exceeds dependency limit');
    await assertOwnedParents(seed,directory);
    const tree=await computerTreeHash(directory);
    if (!tree) throw new Error('Computer Use bundle missing');
    const dependencies=await packageDependencies(directory,seed);
    records.push([relative(directory),tree,dependencies.map(dep=>[dep.name,relative(dep.source)])]);
    for (const dependency of dependencies) await visit(dependency.source);
  }
  await visit(path.join(seed,'node_modules',plugin));
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export async function isBundledComputerCurrent(options:UpdateOptions):Promise<boolean> {
  const plugin = managedPackageSchema.parse(options.plugin ?? pluginName);
  const home=path.resolve(options.moxxyHome);
  const records=await journals(home, plugin);
  if (records.some(({record})=>record.phase==='prepared' || record.phase==='activated')) return false;
  if (!records.some(({record})=>record.phase==='verified' && record.source)) return false;
  await assertOwnedParents(home,targetPath(home, plugin));
  const installed=await computerTreeHash(targetPath(home, plugin));
  const source=await bundleFingerprint(options.resourcesPath, plugin);
  return records.some(({record})=>record.phase==='verified' && record.staged===installed && record.source===source);
}

export async function prepareComputerUpdate(options: UpdateOptions): Promise<PreparedComputerUpdate> {
  const plugin = managedPackageSchema.parse(options.plugin ?? pluginName);
  const home=path.resolve(options.moxxyHome);
  const target=targetPath(home, plugin);
  await assertOwnedParents(home,target);
  await assertOwnedParents(home,updatesPath(home, plugin));
  const seed=path.join(path.resolve(options.resourcesPath),'plugins-seed');
  const source=path.join(seed,'node_modules',plugin);
  if ((await manifest(source)).name !== plugin) throw new Error('Unexpected bundled package');
  const sourceHash=await bundleFingerprint(options.resourcesPath, plugin);
  await fs.mkdir(updatesPath(home, plugin),{recursive:true});
  const transaction=await fs.mkdtemp(path.join(updatesPath(home, plugin),'update-'));
  const staged=path.join(transaction,'staged');
  let count=0;
  async function copy(from: string, to: string, ancestors: ReadonlySet<string>): Promise<void> {
    // OpenAI's SDK has a legitimate nine-level transitive chain. Keep the
    // existing Computer Use bound and the shared package/byte/cycle limits.
    const maxDepth = plugin === pluginName ? 8 : 16;
    if (++count > 64 || ancestors.size > maxDepth || ancestors.has(from)) throw new Error('Unsupported bundled dependency cycle or size');
    await assertOwnedParents(seed,from);
    await computerTreeHash(from);
    await fs.mkdir(path.dirname(to),{recursive:true});
    await fs.cp(from,to,{recursive:true,force:false,errorOnExist:true});
    for (const {name,source:dependency} of await packageDependencies(from,seed)) {
      const destination=path.join(to,'node_modules',name);
      // Nested npm dependencies were copied with their parent; still walk them.
      if (await exists(destination)) await fs.rm(destination,{recursive:true});
      await copy(dependency,destination,new Set([...ancestors,from]));
    }
  }
  try {
    await copy(source,staged,new Set());
    if (await bundleFingerprint(options.resourcesPath, plugin) !== sourceHash) throw new Error('Bundled extension changed while staging');
    const stagedHash=await computerTreeHash(staged);
    if (!stagedHash) throw new Error('Missing staged Computer Use package');
    const installedHash=await computerTreeHash(target);
    const verified=(await journals(home, plugin)).filter(({record})=>record.phase==='verified');
    const localChanges=verified.some(({record})=>record.staged===installedHash) ? 'unchanged' : verified.length ? 'changed' : 'untracked';
    const update:PreparedComputerUpdate=Object.freeze({
      plugin,
      targetPath:target,stagedPath:staged,backupPath:path.join(transaction,'previous'),
      transactionPath:transaction, installedHash,stagedHash,sourceHash,localChanges,
      moxxyHome:home,
    });
    prepared.add(update);
    return update;
  } catch (error) {
    await fs.rm(transaction,{recursive:true,force:true});
    throw error;
  }
}

async function writeJournal(update: PreparedComputerUpdate, phase: Journal['phase'], previous: string | null, ledgers:ComputerLedger[]=[]): Promise<void> {
  const journal:Journal={schemaVersion:1,phase,previous,staged:update.stagedHash,source:update.sourceHash,ledgers};
  await writeFileAtomic(path.join(update.transactionPath,'transaction.json'),JSON.stringify(journal));
}

/** Caller must stop its runners and hold the desktop maintenance lease first. */
export async function activateComputerUpdate(
  update:PreparedComputerUpdate, approvedInstalledHash:string|null,
  verifyInstalled:(directory:string)=>Promise<void>,
):Promise<{backupPath:string}> {
  if (!prepared.has(update)) throw new Error('Unknown Computer Use staging transaction');
  const previous=tails.get(update.targetPath) ?? Promise.resolve();
  const operation=previous.catch(()=>undefined).then(async()=>{
    await assertOwnedParents(update.moxxyHome,update.targetPath);
    await assertOwnedParents(update.moxxyHome,update.transactionPath);
    if (await computerTreeHash(update.targetPath) !== approvedInstalledHash) throw new Error('Installed Computer Use files changed after approval');
    if (await computerTreeHash(update.stagedPath) !== update.stagedHash) throw new Error('Staged Computer Use files changed');
    const ledgers=await prepareComputerLedgers(update.moxxyHome,update.stagedPath,update.transactionPath,update.plugin);
    await writeJournal(update,'prepared',approvedInstalledHash,ledgers);
    let oldMoved=false, newMoved=false;
    try {
      if (approvedInstalledHash !== null) { await fs.rename(update.targetPath,update.backupPath); oldMoved=true; }
      if (oldMoved && await computerTreeHash(update.backupPath) !== approvedInstalledHash) throw new Error('Computer Use files changed during activation');
      await fs.mkdir(path.dirname(update.targetPath),{recursive:true});
      await fs.rename(update.stagedPath,update.targetPath); newMoved=true;
      await writeJournal(update,'activated',approvedInstalledHash,ledgers);
      if (await computerTreeHash(update.targetPath) !== update.stagedHash) throw new Error('Computer Use bytes changed before verification');
      await verifyInstalled(update.targetPath);
      if (await computerTreeHash(update.targetPath) !== update.stagedHash) throw new Error('Installed Computer Use bytes changed during verification');
      await applyComputerLedgers(update.moxxyHome,update.transactionPath,ledgers);
      await writeJournal(update,'verified',approvedInstalledHash,ledgers);
      prepared.delete(update);
      return {backupPath:update.backupPath};
    } catch (error) {
      if (newMoved) {
        if (await computerTreeHash(update.targetPath) !== update.stagedHash) throw new Error('Computer Use recovery needs review: installed files were modified; previous copy preserved');
        await fs.rename(update.targetPath,path.join(update.transactionPath,'rejected'));
      }
      if (oldMoved) await fs.rename(update.backupPath,update.targetPath);
      await applyComputerLedgers(update.moxxyHome,update.transactionPath,ledgers,true);
      await writeJournal(update,'rolled_back',approvedInstalledHash,ledgers);
      prepared.delete(update);
      throw error;
    }
  });
  tails.set(update.targetPath,operation);
  try { return await operation; }
  finally { if (tails.get(update.targetPath) === operation) tails.delete(update.targetPath); }
}

export async function discardComputerUpdate(update:PreparedComputerUpdate):Promise<void> {
  if (!prepared.has(update)) return;
  await fs.rm(update.stagedPath,{recursive:true,force:true});
  // A transaction with a journal/backup is retained for recovery, never removed.
  if ((await fs.readdir(update.transactionPath)).length === 0) await fs.rmdir(update.transactionPath);
  prepared.delete(update);
}

/** Run before any runner starts, while holding the same maintenance lease. */
export async function recoverComputerUpdates(moxxyHome: string, plugin: ManagedPackage = pluginName): Promise<string[]> {
  managedPackageSchema.parse(plugin);
  const home=path.resolve(moxxyHome), target=targetPath(home, plugin);
  await assertOwnedParents(home,target);
  const restored:string[]=[];
  for (const {directory,file,record} of await journals(home, plugin)) {
    if (record.phase === 'verified' || record.phase === 'rolled_back') continue;
    await applyComputerLedgers(home,directory,record.ledgers ?? [],true);
    const backup=path.join(directory,'previous');
    const current=await computerTreeHash(target), saved=await computerTreeHash(backup);
    if (current === record.previous && saved === null) {
      // Journal was persisted before the first rename, or rollback already restored it.
    } else {
      if (saved !== record.previous) throw new Error('Computer Use backup changed; manual recovery required');
      if (current !== null) {
        if (current !== record.staged) throw new Error('Computer Use target changed; manual recovery required');
        await fs.rename(target,path.join(directory,'rejected'));
      }
      if (saved !== null) await fs.rename(backup,target);
    }
    await writeFileAtomic(file,JSON.stringify({...record,phase:'rolled_back'}));
    restored.push(directory);
  }
  return restored;
}
