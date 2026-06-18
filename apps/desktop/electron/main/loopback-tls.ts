/**
 * Scoped trust for the in-app loopback HTTPS server's self-signed cert.
 *
 * The packaged renderer is served from `https://desktop.moxxy.ai:<port>` (a
 * moxxy.ai subdomain origin a `pk_live_` Clerk key requires). The cert is minted
 * locally; these factories build the two trust hooks that scope-trust ONLY that
 * host + port + fingerprint and defer everything else to Chromium:
 *   - the `session.setCertificateVerifyProc` proc (the canonical mechanism), and
 *   - the `app.on('certificate-error')` handler (belt-and-braces).
 *
 * Extracted from `index.ts`. The cert is read through a `getCert` accessor so
 * these stay decoupled from the module-level `loopbackCert` singleton (which is
 * assigned before the window loads, so there is no null-at-fire-time race).
 */
import type { SelfSignedCert } from '@moxxy/desktop-host';
import { isTrustedLoopbackCert, isTrustedLoopbackCertByHost } from '@moxxy/desktop-host';

/**
 * Build the `setCertificateVerifyProc` callback. Trusts the presented cert iff
 * its host is our loopback host AND its fingerprint matches the minted cert;
 * otherwise returns -3 to defer to Chromium's own verification result.
 */
export function makeCertVerifyProc(
  getCert: () => SelfSignedCert | null,
): (request: Electron.Request, callback: (verificationResult: number) => void) => void {
  return (request, callback) => {
    const cert = getCert();
    if (
      cert &&
      isTrustedLoopbackCertByHost({
        hostname: request.hostname,
        fingerprint: request.certificate.fingerprint,
        expectedFingerprint: cert.fingerprint256,
      })
    ) {
      callback(0); // 0 = trust this cert (our minted loopback cert)
      return;
    }
    callback(-3); // -3 = defer to Chromium's own verification result
  };
}

/**
 * Build the `app.on('certificate-error')` handler. Rarely fires for the loopback
 * load (the verify-proc is canonical) but costs nothing and covers any path the
 * verify-proc doesn't, with the identical scoped trust (host + port +
 * fingerprint). Everything else gets normal verification (reject).
 */
export function makeCertificateErrorHandler(
  getCert: () => SelfSignedCert | null,
  allowedPorts: ReadonlyArray<number>,
): (
  event: Electron.Event,
  webContents: Electron.WebContents,
  url: string,
  error: string,
  certificate: Electron.Certificate,
  callback: (isTrusted: boolean) => void,
) => void {
  return (event, _wc, url, _error, certificate, callback) => {
    const cert = getCert();
    if (
      cert &&
      isTrustedLoopbackCert({
        url,
        fingerprint: certificate.fingerprint,
        expectedFingerprint: cert.fingerprint256,
        allowedPorts,
      })
    ) {
      event.preventDefault();
      callback(true); // trust it
      return;
    }
    callback(false); // normal verification (reject)
  };
}
