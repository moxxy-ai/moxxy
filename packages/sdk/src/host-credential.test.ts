import { describe, expect, it } from 'vitest';
import { hostCredentialName } from './secret-provider.js';

describe('hostCredentialName', () => {
  it('upper-snakes a host, mirroring the provider-key convention', () => {
    expect(hostCredentialName('github.example.com')).toBe('MOXXY_CREDENTIAL_GITHUB_EXAMPLE_COM');
  });

  it('accepts a full URL and uses only its host', () => {
    expect(hostCredentialName('https://registry.example.internal/moxxy/index.json')).toBe(
      'MOXXY_CREDENTIAL_REGISTRY_EXAMPLE_INTERNAL',
    );
  });

  // A credential belongs to the host, not to a socket, so the same secret
  // serves the mirror whether or not the URL happens to name a port.
  it('ignores the port', () => {
    expect(hostCredentialName('registry.internal:8443')).toBe(hostCredentialName('registry.internal'));
    expect(hostCredentialName('https://registry.internal:8443/x')).toBe(
      hostCredentialName('registry.internal'),
    );
  });

  it('collapses runs of non-alphanumerics and trims the edges', () => {
    expect(hostCredentialName('my--host..internal')).toBe('MOXXY_CREDENTIAL_MY_HOST_INTERNAL');
  });

  it('handles an IPv6 literal', () => {
    expect(hostCredentialName('https://[::1]:9000/x')).toBe('MOXXY_CREDENTIAL_1');
  });

  // Deriving a name from garbage would silently look up the wrong secret, which
  // reads as "no credential configured" rather than as the typo it is.
  it('returns null rather than a name derived from nonsense', () => {
    for (const bad of ['', '   ', 'not a host', 'https://', '://x']) {
      expect(hostCredentialName(bad)).toBeNull();
    }
  });
});
