import vitestPreset from '@moxxy/vitest-preset';
import { defineConfig, mergeConfig } from 'vitest/config';

// These tests spawn REAL Node child processes and do IPC round-trips. Under the
// full-repo parallel run (turbo locally / CI matrix) that contends for CPU, a
// subprocess spawn + handshake can briefly exceed the shared 10s default and
// flake — a load artifact, not a real failure. Give the worst-case timing path
// generous headroom so a loaded box can't turn a green suite red.
export default mergeConfig(
  vitestPreset,
  defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } }),
);
