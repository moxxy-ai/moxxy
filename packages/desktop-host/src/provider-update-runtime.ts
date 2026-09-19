import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compareSemver, z } from '@moxxy/sdk';
import {
  activateComputerUpdate, discardComputerUpdate, isBundledComputerCurrent,
  prepareComputerUpdate, recoverComputerUpdates, type PreparedComputerUpdate,
} from './computer-update.js';

const providerPackage = z.enum(['@moxxy/plugin-provider-openai', '@moxxy/plugin-provider-openai-codex']);
const versionSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/) });
export interface ProviderUpdateOffer {
  plugin: z.infer<typeof providerPackage>;
  backupPath: string;
  localChanges: PreparedComputerUpdate['localChanges'];
  downgrade: boolean;
}

// Import only: never create a client, access the vault or perform OAuth here.
const probe = `import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const {default:plugin}=await import(pathToFileURL(join(process.argv[1],'dist/index.js')).href);
const name=process.argv[2];
if(plugin.name!==name || !Array.isArray(plugin.providers)) throw Error('Provider identity mismatch');
const provider=plugin.providers.find(p=>p.name===name.slice('@moxxy/plugin-provider-'.length));
if(!provider || typeof provider.createClient!=='function' || !Array.isArray(provider.models) ||
 !provider.models.length || provider.models.some(m=>typeof m.id!=='string' || !m.id)) throw Error('Provider catalog missing');
console.log('MOXXY_PROVIDER_UPDATE_VERIFIED');`;

async function verifyProvider(directory: string, plugin: string): Promise<void> {
  const child = spawn(process.execPath, ['--input-type=module', '-e', probe, directory, plugin], {
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  await new Promise<void>((resolve, reject) => {
    let output = '', bytes = 0, expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, 15000);
    const drain = (chunk: Buffer, stdout: boolean) => {
      bytes += chunk.length;
      if (bytes > 64000) { expired = true; child.kill(); return; }
      if (stdout) output += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => drain(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => drain(chunk, false));
    child.once('error', () => { clearTimeout(timer); reject(new Error('Provider verification process could not start')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (!expired && code === 0 && output.trim() === 'MOXXY_PROVIDER_UPDATE_VERIFIED') resolve();
      else reject(new Error('Provider failed isolated runtime verification; previous version retained'));
    });
  });
}

/** Packaged desktop only, before any runner loads these modules. No npm access. */
export async function offerBundledProviderUpdate(options: {
  resourcesPath: string; moxxyHome: string; plugin: ProviderUpdateOffer['plugin'];
  freshInstall?: boolean;
  confirm: (offer: ProviderUpdateOffer) => Promise<boolean>;
}): Promise<'current' | 'declined' | 'updated'> {
  const plugin = providerPackage.parse(options.plugin);
  await recoverComputerUpdates(options.moxxyHome, plugin);
  if (await isBundledComputerCurrent(options)) return 'current';
  const update = await prepareComputerUpdate(options);
  try {
    const staged = versionSchema.parse(JSON.parse(await readFile(join(update.stagedPath, 'package.json'), 'utf8')));
    const installed = update.installedHash ? versionSchema.safeParse(JSON.parse(await readFile(join(update.targetPath, 'package.json'), 'utf8'))) : null;
    const downgrade = !!installed?.success && compareSemver(staged.version, installed.data.version) < 0;
    const needsApproval = downgrade || (update.installedHash !== null && !options.freshInstall && update.localChanges !== 'unchanged');
    if (needsApproval && !await options.confirm({ plugin, backupPath: update.backupPath, localChanges: update.localChanges, downgrade })) return 'declined';
    await activateComputerUpdate(update, update.installedHash, directory => verifyProvider(directory, plugin));
    return 'updated';
  } finally { await discardComputerUpdate(update); }
}
