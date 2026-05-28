import { test, expect } from '@playwright/test';

test.describe('moxxy desktop — smoke', () => {
  test.skip(({}, testInfo) => !testInfo.project.use.baseURL, 'baseURL must be set');

  test('renders the brand mark', async ({ page, baseURL }) => {
    await page.goto(baseURL ?? 'http://localhost:1420');
    await expect(page.getByText('moxxy')).toBeVisible();
  });
});
