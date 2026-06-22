// MUST be first: installs globalThis.crypto.getRandomValues (via expo-crypto)
// before any transport module runs, so the E2E pairing handshake has the RNG
// Hermes otherwise lacks. Side-effect import — keep it above everything else.
import './src/cryptoPolyfill';

import { installConsoleFilters } from './src/consoleFilters';

installConsoleFilters();

import 'expo-router/entry';
