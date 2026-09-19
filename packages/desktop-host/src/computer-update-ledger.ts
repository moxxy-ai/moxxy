import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { z } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';
import { readBoundedFile } from './bounded-read.js';

const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export const computerLedgerSchema=z.object({
  file:z.enum(['package.json','package-lock.json']),
  before:z.string().regex(/^[a-f0-9]{64}$/),after:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ComputerLedger=z.infer<typeof computerLedgerSchema>;
const object=z.record(z.unknown());
const dependencies=z.record(z.string());

async function read(file:string):Promise<Buffer|null> {
  try {
    return await readBoundedFile(file,4_000_000,'Invalid Computer Use package ledger');
  } catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return null; throw error; }
}

export async function prepareComputerLedgers(home:string,staged:string,transaction:string,plugin='@moxxy/plugin-computer-control'):Promise<ComputerLedger[]> {
  z.enum(['@moxxy/plugin-computer-control','@moxxy/plugin-provider-openai','@moxxy/plugin-provider-openai-codex']).parse(plugin);
  const prefix='node_modules/'+plugin;
  const bytes=await read(path.join(staged,'package.json'));
  if (!bytes) throw new Error('Staged manifest missing');
  const pkg=object.parse(JSON.parse(bytes.toString('utf8')));
  if (pkg.name !== plugin) throw new Error('Staged package identity mismatch');
  const version=z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/).parse(pkg.version);
  const changes:ComputerLedger[]=[];
  for (const file of ['package.json','package-lock.json'] as const) {
    const before=await read(path.join(home,'plugins',file));
    if (!before) continue;
    const data=object.parse(JSON.parse(before.toString('utf8')));
    if (file==='package.json') data.dependencies={...dependencies.parse(data.dependencies ?? {}),[plugin]:version};
    else {
      z.number().int().min(2).max(3).parse(data.lockfileVersion);
      const packages=object.parse(data.packages),root=object.parse(packages['']);
      packages['']={...root,dependencies:{...dependencies.parse(root.dependencies ?? {}),[plugin]:version}};
      for (const name of Object.keys(packages)) if (name===prefix || name.startsWith(prefix+'/')) delete packages[name];
      let count=0;
      async function collect(directory:string,key:string):Promise<void> {
        if (++count>64) throw new Error('Computer Use dependency ledger exceeds limit');
        const info=await fs.lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid Computer Use dependency directory');
        const content=await read(path.join(directory,'package.json'));
        if (!content) throw new Error('Computer Use dependency manifest missing');
        const manifest=object.parse(JSON.parse(content.toString('utf8')));
        const entry:Record<string,unknown>={version:z.string().parse(manifest.version)};
        for (const field of ['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','engines','os','cpu']) {
          if (manifest[field]!==undefined) entry[field]=manifest[field];
        }
        packages[key]=entry;
        const modules=path.join(directory,'node_modules');
        let names:string[];
        try {
          const info=await fs.lstat(modules);
          if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid Computer Use dependency directory');
          names=await fs.readdir(modules);
        }
        catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return; throw error; }
        for (const name of names) {
          if (name.startsWith('.')) continue;
          const info=await fs.lstat(path.join(modules,name));
          if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid Computer Use dependency directory');
          const children=name.startsWith('@') ? (await fs.readdir(path.join(modules,name))).map(child=>name+'/'+child) : [name];
          for (const child of children) await collect(path.join(modules,child),key+'/node_modules/'+child);
        }
      }
      await collect(staged,prefix);
      data.packages=packages;
    }
    const after=JSON.stringify(data,null,2)+'\n';
    if (hash(before)===hash(after)) continue;
    await fs.writeFile(path.join(transaction,'ledger-'+file+'-before'),before,{mode:0o600,flag:'wx'});
    await fs.writeFile(path.join(transaction,'ledger-'+file+'-after'),after,{mode:0o600,flag:'wx'});
    changes.push({file,before:hash(before),after:hash(after)});
  }
  return changes;
}

export async function applyComputerLedgers(home:string,transaction:string,ledgers:ReadonlyArray<ComputerLedger>,reverse=false):Promise<void> {
  for (const change of ledgers) {
    const from=reverse ? change.after : change.before, to=reverse ? change.before : change.after;
    const target=path.join(home,'plugins',change.file),current=await read(target);
    if (current && hash(current)===to) continue;
    if (!current || hash(current)!==from) throw new Error('Computer Use npm ledger changed concurrently; manual recovery required');
    const replacement=await read(path.join(transaction,'ledger-'+change.file+(reverse ? '-before' : '-after')));
    if (!replacement || hash(replacement)!==to) throw new Error('Computer Use ledger recovery copy changed');
    await writeFileAtomic(target,replacement);
  }
}
