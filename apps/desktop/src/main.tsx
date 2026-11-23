import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/electron/react';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { DeepLinkBridge } from './lib/useDeepLink';
import { TipLayer } from './components/tip/TipLayer';
import { HotkeyHints } from './hotkeys/HotkeyHints';
import { KeySyncSession } from './shell/account/KeySyncSession';
import { AccountIdentityBridge } from './shell/account/AccountIdentityBridge';
import { bootClient } from './lib/boot';
import { registerModeEvents } from './chat/modes/register-mode-events';
import './styles.css';

// Install the shared client's transport + platform capabilities before the
// React tree (and its hooks/bridges) mount.
bootClient();
registerModeEvents();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found — check index.html');

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();

function DesktopClerkProvider({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      allowedRedirectProtocols={['moxxy:']}
      allowedRedirectOrigins={[window.location.origin]}
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <AccountIdentityBridge />
      {import.meta.env.VITE_ACCOUNT_SYNC_URL?.trim() && <KeySyncSession />}
      {children}
    </ClerkProvider>
  );
}

const Tree = CLERK_KEY ? (
  <DesktopClerkProvider publishableKey={CLERK_KEY}>
    <App />
  </DesktopClerkProvider>
) : (
  <App />
);

// ErrorBoundary sits OUTSIDE ClerkProvider so it also catches a provider
// init throw (e.g. a malformed key). Without a boundary, any uncaught
// renderer error unmounts the whole React tree → a blank white window with
// nothing logged — which is exactly what a keyless build did (useUser threw
// because no <ClerkProvider> was rendered). The DeepLinkBridge sits outside
// Clerk too (it needs no auth context) and is mounted once here so it's
// always listening regardless of which App gate is showing.
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DeepLinkBridge />
      {Tree}
      <TipLayer />
      <HotkeyHints />
    </ErrorBoundary>
  </React.StrictMode>,
);
