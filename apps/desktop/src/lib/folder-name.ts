/** A folder's own name, the last part of its path on Windows as on macOS and Linux; null for a root or drive. */
export function folderName(folder: string): string | null {
  const last = folder.split(/[\\/]/).filter(Boolean).pop();
  return last && !/^[A-Za-z]:$/.test(last) ? last : null;
}
