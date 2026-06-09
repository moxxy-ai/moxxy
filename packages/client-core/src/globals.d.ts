/**
 * Cross-platform timer globals.
 *
 * This package compiles with `lib: ["ES2023"]` and `types: []` — deliberately
 * DOM-free and Node-free, so any stray `window` / `document` / `MediaRecorder` /
 * `localStorage` reference fails to compile (forcing platform-specific code
 * behind the capability registry). But `setTimeout`/`clearTimeout`/`setInterval`
 * are genuinely universal (browsers, Node, and React Native all provide them),
 * so declare just those here with a platform-neutral numeric handle.
 */

declare function setTimeout(handler: () => void, ms?: number): number;
declare function clearTimeout(handle: number | undefined): void;
declare function setInterval(handler: () => void, ms?: number): number;
declare function clearInterval(handle: number | undefined): void;
