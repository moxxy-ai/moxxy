import type { ProviderRequest } from '@moxxy/sdk';

const NATIVE_BROWSER_ROUTING = [
  'Moxxy Browser is the in-app browser shared by the user and the agent.',
  'When the user refers to Moxxy Browser, its browser pane, a numbered browser tab,',
  'the current page, or asks what is visible there, use browser_session.',
  'Start with browser_session observe and act on returned element refs or',
  'Moxxy-browser viewport coordinates. Never use computer_* tools, AppleScript,',
  'or a full-desktop screenshot for Moxxy Browser.',
  'Use computer_* only when the user explicitly targets another desktop app',
  'such as Safari, Chrome, Finder, or a non-browser native application.',
].join(' ');

export function injectNativeBrowserRouting(
  request: ProviderRequest,
  environment: Readonly<Record<string, string | undefined>>,
): ProviderRequest {
  if (environment.MOXXY_BROWSER_BACKEND?.trim().toLowerCase() !== 'native') return request;
  if (request.system?.includes(NATIVE_BROWSER_ROUTING)) return request;
  return {
    ...request,
    system: request.system
      ? `${request.system}\n\n${NATIVE_BROWSER_ROUTING}`
      : NATIVE_BROWSER_ROUTING,
  };
}
