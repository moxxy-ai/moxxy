/**
 * Questions for browser and React Native clients (`@moxxy/sdk/questions`):
 * the root entry pulls Node built-ins a renderer bundle cannot load.
 */
export * from './question.js';
export * from './question-draft.js';

export const ENV_SHARE_PRIVACY_NOTE = 'Moxxy encrypts this value in your local vault. Env Share never sends it to AI models.';
