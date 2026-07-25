import { describe, expect, it } from 'vitest';

import { BUNDLED_WORKSPACE_DEPS } from '../electron.vite.config.js';

describe('desktop main-process workspace bundling', () => {
  it('bundles the browser security dependency used by the Electron main process', () => {
    expect(BUNDLED_WORKSPACE_DEPS).toContain('@moxxy/plugin-browser');
  });
});
