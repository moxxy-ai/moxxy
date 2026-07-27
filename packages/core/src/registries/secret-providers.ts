import type { SecretProviderDef } from '@moxxy/sdk';
import { ActiveDefRegistry } from './active-def-registry.js';

/**
 * The single-active SecretProvider registry.
 *
 * Unlike the event-store and audit-sink registries, core seeds NO floor here:
 * the built-in vault lives in `@moxxy/plugin-vault`, and core never imports a
 * plugin. The host (the CLI) registers the vault as the protected floor at
 * boot, which keeps the dependency arrow pointing the right way.
 *
 * Throw-on-duplicate `register`, so a discovered plugin's provider is added but
 * never silently becomes active. That opt-in matters more here than almost
 * anywhere: a secret provider is asked for plaintext credentials by name, so a
 * provider that activated itself would be a credential-harvesting path.
 */
export class SecretProviderRegistry extends ActiveDefRegistry<SecretProviderDef> {
  constructor() {
    super({ noun: 'SecretProvider' });
  }
}
