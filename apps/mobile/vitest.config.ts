import { defineConfig } from 'vitest/config';
import { isolateSetupFile } from '@moxxy/vitest-preset';

export default defineConfig({ test: { setupFiles: [isolateSetupFile] } });
