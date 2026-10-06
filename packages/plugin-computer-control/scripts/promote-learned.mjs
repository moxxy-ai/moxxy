// Adds what this computer learned about apps to the lessons that ship with the plugin (`learned/`).
// usage: pnpm --filter @moxxy/plugin-computer-control learned:promote [directory]
import { moxxyPath } from '@moxxy/sdk/server';
import { promote, shippedLearned } from '../dist/jev/memory.js';

const from = process.argv[2] ?? moxxyPath('computer-use', 'learned');
const apps = await promote(from, shippedLearned);
console.log(apps.length === 0 ? `Nothing learned in ${from}.` : `Shipped lessons updated for: ${apps.join(', ')}\nRead the diff of ${shippedLearned} before committing: targets and routes are stored as written.`);
