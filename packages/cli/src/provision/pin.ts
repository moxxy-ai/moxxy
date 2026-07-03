// The pin lives in @moxxy/plugin-plugins-admin so every install path (the
// install_plugin tool, `moxxy plugins install`, the TUI picker, provision)
// shares one implementation. Re-exported here to keep provision-local imports.
export { pinFirstPartySpec } from '@moxxy/plugin-plugins-admin';
