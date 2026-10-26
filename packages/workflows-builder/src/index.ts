/**
 * @moxxy/workflows-builder — the DOM-free model behind the visual workflow
 * builder. It owns the canvas state + reducer, the pure graph operations, the
 * Workflow<->YAML serializer pair (with auto-layout), and the validate/save
 * bridges over the workflows IPC. The Electron desktop canvas imports from here
 * and adds only rendering + interaction on top.
 */

export * from './types.js';
export * from './operations.js';
export * from './serialize.js';
export * from './reducer.js';
export * from './validation.js';
export { toYaml, fromYaml } from './yaml.js';
