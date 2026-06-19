/**
 * Local Expo config plugin: scope Android cleartext (ws:// / http://) to the LAN
 * instead of the whole internet.
 *
 * The blanket `usesCleartextTraffic: true` we used before permits cleartext to
 * ANY host app-wide. Combined with the QR pairing flow (which can be pointed at
 * an arbitrary, even public, host), that let a confirmed connection to a public
 * `ws://` endpoint ride with no TLS. This plugin instead emits an Android
 * `network_security_config.xml` that:
 *   - denies cleartext by DEFAULT (public traffic is forced to TLS), and
 *   - permits cleartext ONLY for localhost + the private IPv4 ranges where the
 *     LAN runner legitimately lives and no CA can issue a cert (see README).
 *
 * Tunnel mode already uses `wss://` (publicly-trusted TLS) and is unaffected.
 *
 * Uses only `expo/config-plugins` (re-exported by the already-present `expo`
 * dependency) — no new npm dep.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

const XML_FILENAME = 'network_security_config.xml';

// Base config = NO cleartext. Then a per-domain allow-list for localhost + the
// three private IPv4 blocks (10/8, 172.16/12 — enumerated, and 192.168/16).
// `includeSubdomains` lets a single prefix domain cover the whole block.
const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">127.0.0.1</domain>
        <domain includeSubdomains="true">10.0.0.0</domain>
        <domain includeSubdomains="true">172.16.0.0</domain>
        <domain includeSubdomains="true">172.17.0.0</domain>
        <domain includeSubdomains="true">172.18.0.0</domain>
        <domain includeSubdomains="true">172.19.0.0</domain>
        <domain includeSubdomains="true">172.20.0.0</domain>
        <domain includeSubdomains="true">172.21.0.0</domain>
        <domain includeSubdomains="true">172.22.0.0</domain>
        <domain includeSubdomains="true">172.23.0.0</domain>
        <domain includeSubdomains="true">172.24.0.0</domain>
        <domain includeSubdomains="true">172.25.0.0</domain>
        <domain includeSubdomains="true">172.26.0.0</domain>
        <domain includeSubdomains="true">172.27.0.0</domain>
        <domain includeSubdomains="true">172.28.0.0</domain>
        <domain includeSubdomains="true">172.29.0.0</domain>
        <domain includeSubdomains="true">172.30.0.0</domain>
        <domain includeSubdomains="true">172.31.0.0</domain>
        <domain includeSubdomains="true">192.168.0.0</domain>
    </domain-config>
</network-security-config>
`;

/** Write res/xml/network_security_config.xml into the prebuilt android project. */
function withNetworkSecurityConfigFile(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const xmlDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      await fs.promises.mkdir(xmlDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(xmlDir, XML_FILENAME),
        NETWORK_SECURITY_CONFIG,
        'utf8',
      );
      return cfg;
    },
  ]);
}

/** Point <application> at the config and drop any blanket cleartext flag. */
function withNetworkSecurityConfigManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    // The scoped config supersedes the blanket flag; remove it if present so the
    // two can't disagree.
    delete app.$['android:usesCleartextTraffic'];
    return cfg;
  });
}

module.exports = function withLanCleartext(config) {
  return withNetworkSecurityConfigManifest(withNetworkSecurityConfigFile(config));
};
