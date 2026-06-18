// The skill frontmatter parser now lives canonically in @moxxy/sdk
// (`parseFrontmatterFile`/`parseFrontmatter`), shared with plugin-memory so the
// previously-copy-pasted copies can't diverge. This module keeps the historical
// `parseSkillFile`/`ParsedSkillFile` names as thin re-exports.
import { parseFrontmatterFile, type ParsedFrontmatter } from '@moxxy/sdk';

export type ParsedSkillFile = ParsedFrontmatter;

export const parseSkillFile = parseFrontmatterFile;

export { parseFrontmatter } from '@moxxy/sdk';
