import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { DeepLinkBridge } from './lib/useDeepLink';
import { bootClient } from './lib/boot';
import './styles.css';

// Install the shared client's transport + platform capabilities before the
// React tree (and its hooks/bridges) mount.
bootClient();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found — check index.html');

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// The packaged renderer is served from a loopback origin
// (http://127.0.0.1:<port>, see electron/main loopback server). Clerk's web
// SDK refuses to redirect a post-auth flow to an origin it doesn't trust, so
// allow-list the loopback origins (matches the main process's LOOPBACK_PORTS).
// Pair this with the SAME origins added to the Clerk dashboard's allowed
// origins / redirect URLs (the server-side check).
const LOOPBACK_REDIRECT_ORIGINS = /^http:\/\/(127\.0\.0\.1|localhost):(51789|51790|51791|51792)$/;

const Tree = CLERK_KEY ? (
  <ClerkProvider publishableKey={CLERK_KEY} allowedRedirectOrigins={[LOOPBACK_REDIRECT_ORIGINS]}>
    <App />
  </ClerkProvider>
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
    </ErrorBoundary>
  </React.StrictMode>,
);
