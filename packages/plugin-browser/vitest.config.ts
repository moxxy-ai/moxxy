import preset from '@moxxy/vitest-preset';

export default {
  ...preset,
  test: {
    ...preset.test,
    // The preset isolates HOME. Keep Chromium in Playwright's package instead.
    env: { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '0' },
  },
};
