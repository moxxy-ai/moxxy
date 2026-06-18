// The MD+frontmatter parser now lives canonically in @moxxy/sdk
// (`parseFrontmatterFile`/`parseFrontmatter`/`renderFrontmatter`), shared with
// @moxxy/core so the previously-copy-pasted copies can't diverge. This module
// keeps the historical `parseMdFile`/`ParsedFile` names as thin re-exports.
// (The plugin already depends on @moxxy/sdk, so this stays leaf-only.)
import { parseFrontmatterFile, type ParsedFrontmatter } from '@moxxy/sdk';

export type ParsedFile = ParsedFrontmatter;

export const parseMdFile = parseFrontmatterFile;

export { parseFrontmatter, renderFrontmatter } from '@moxxy/sdk';
