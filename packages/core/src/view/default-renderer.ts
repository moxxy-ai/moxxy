import { DEFAULT_VIEW_TAGS, defineViewRenderer } from '@moxxy/sdk';
import { parseView, validateDoc } from './parse.js';

/**
 * The built-in view-spec renderer, seeded into every session's
 * {@link ViewRendererRegistry}. Plugins may register/replace and `setActive`
 * an alternative renderer with a different vocabulary.
 */
export const defaultViewRenderer = defineViewRenderer({
  name: 'moxxy/default',
  allowList: DEFAULT_VIEW_TAGS,
  parse: (source) => parseView(source, DEFAULT_VIEW_TAGS),
  validate: (doc) => validateDoc(doc, DEFAULT_VIEW_TAGS),
});
