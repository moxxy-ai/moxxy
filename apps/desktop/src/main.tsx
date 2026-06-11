import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { dark } from '@clerk/themes';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { DeepLinkBridge } from './lib/useDeepLink';
import { OAuthTransferBridge } from './lib/oauthTransfer';
import { bootClient } from './lib/boot';
import './styles.css';

// Install the shared client's transport + platform capabilities before the
// React tree (and its hooks/bridges) mount.
bootClient();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found — check index.html');

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// The packaged renderer is served from the loopback server at
// `https://desktop.moxxy.ai:<port>` (a moxxy.ai subdomain → Clerk production
// keys accept the origin; see electron/main loopback server). Clerk's web SDK
// refuses to redirect a post-auth flow to an origin it doesn't trust, so
// allow-list that origin on the fixed LOOPBACK_PORTS. `localhost`/`127.0.0.1`
// stay allowed for the dev (Vite) origin + the file:// fallback path. Pair this
// with the SAME origins added to the Clerk dashboard's allowed origins /
// redirect URLs (the server-side check — see docs/desktop-clerk-loopback-subdomain.md).
const REDIRECT_ORIGINS =
  /^(https:\/\/desktop\.moxxy\.ai|http:\/\/(127\.0\.0\.1|localhost)):(51789|51790|51791|51792)$/;

// Reactive view of the app theme. `useTheme()` (mounted once in App, inside
// the provider) owns the `data-theme` attribute on <html> — observing that
// attribute is the single source of truth, and it also catches OS-driven
// flips while the preference is `system` (which watching only the persisted
// pref would miss). useSyncExternalStore + MutationObserver keeps this a
// plain subscription with no extra state to reconcile.
function subscribeToDataTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

function isDocumentDark(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

// signIn/signUpFallbackRedirectUrl pin the post-auth landing to the app's own
// origin ('/' resolves against the serving origin above). Without an explicit
// target, the OAuth code-exchange leg can lose the redirect_url and Clerk's
// FAPI then falls back to the HOSTED Account Portal (accounts.<domain>) —
// stranding the desktop window on "My account" instead of back in the app.
// The `appearance` prop follows <html data-theme> so Clerk's modals (openSignIn
// etc.) flip with the rest of the app — ClerkProvider applies appearance
// updates reactively, so an open modal restyles live too.
function ThemedClerkProvider({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: React.ReactNode;
}): React.ReactElement {
  const isDark = React.useSyncExternalStore(subscribeToDataTheme, isDocumentDark);
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      allowedRedirectOrigins={[REDIRECT_ORIGINS]}
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      appearance={{ baseTheme: isDark ? dark : undefined }}
    >
      {/* Completes a dangling OAuth sign-up "transfer" (new-user sign-in)
          that the full-window redirect flow failed to finish — see
          lib/oauthTransfer.tsx. Needs Clerk context, hence inside the
          provider; mounted before children so it sweeps on boot. */}
      <OAuthTransferBridge />
      {children}
    </ClerkProvider>
  );
}

const Tree = CLERK_KEY ? (
  <ThemedClerkProvider publishableKey={CLERK_KEY}>
    <App />
  </ThemedClerkProvider>
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
