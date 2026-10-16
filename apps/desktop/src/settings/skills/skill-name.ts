/** What a skill is called on screen: a flat `<name>.md` drops its extension,
 *  a folder skill (`<name>/SKILL.md`) is named by its folder. */
export function skillDisplayName(fileName: string): string {
  return fileName.replace(/\/SKILL\.md$/, '').replace(/\.md$/, '');
}
