import { expect, it } from 'vitest';
import { isAppDocument } from './trusted-document';

it('exposes IPC only on the app origin or its exact fallback file', () => {
  const app = 'https://desktop.moxxy.ai:51789';
  expect(isAppDocument(app, app + '/index.html?callback=1')).toBe(true);
  expect(isAppDocument(app, 'https://accounts.google.com')).toBe(false);
  expect(isAppDocument(app, 'https://desktop.moxxy.ai:51790')).toBe(false);
  expect(isAppDocument(app, 'blob:' + app + '/test')).toBe(false);
  expect(isAppDocument(undefined, app)).toBe(false);
  expect(isAppDocument('file:///app/index.html', 'file:///app/index.html#chat')).toBe(true);
  expect(isAppDocument('file:///app/index.html', 'file:///download/site.html')).toBe(false);
});
