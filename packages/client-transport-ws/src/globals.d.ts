/**
 * Cross-platform timer globals — see the note in @moxxy/client-core. Declared
 * here so this package stays DOM-free (`lib: ["ES2023"]`, `types: []`) yet can
 * schedule reconnects with the universal `setTimeout`/`clearTimeout`.
 */

declare function setTimeout(handler: () => void, ms?: number): number;
declare function clearTimeout(handle: number | undefined): void;
