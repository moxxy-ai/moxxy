/**
 * The pdfjs-dist worker is a side-effect-only ESM module (it registers the
 * worker in the current realm so the main-thread "fake worker" can run — see
 * {@link ../src/pdf-text.ts}). It ships no type declarations, so declare it as
 * an empty module to satisfy the dynamic `import()`.
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
