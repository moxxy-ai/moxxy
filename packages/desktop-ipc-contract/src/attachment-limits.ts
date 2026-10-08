/**
 * How large a file attached to a prompt may be. Shared, so the renderer can
 * refuse a file the moment it is dropped instead of the host dropping it
 * silently when the prompt is sent.
 */

const MB = 1024 * 1024;

export const ATTACHMENT_LIMITS = Object.freeze({
  /** An image goes to the model whole; this is what providers accept. */
  imageBytes: 8 * MB,
  /** A file handed over as bytes (dropped or pasted) crosses the IPC boundary in one piece. */
  fileBytes: 32 * MB,
});

/** The images the model can see, by the extensions the host reads as one. */
const IMAGE_NAME = /\.(?:png|jpe?g|gif|webp|bmp)$/iu;

export function isImageFileName(name: string): boolean {
  return IMAGE_NAME.test(name);
}

/** A size as a file manager writes it: `12.4 MB`, `80 MB`, `2.5 GB`. */
export function formatFileSize(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Rounded up, so a file a byte over a limit never reads as the limit itself.
  const shown = unit === 0 ? String(value) : String(Math.ceil(value * 10) / 10);
  return `${shown} ${units[unit] ?? 'bytes'}`;
}

/**
 * Why a file of this size cannot be attached, as a sentence for the person, or
 * null when it can. `image` says what the name alone cannot (a path that ends
 * in `.png` shown under another name).
 */
export function attachmentSizeProblem(file: {
  readonly name: string;
  readonly size: number;
  readonly image?: boolean;
}): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  const image = file.image ?? isImageFileName(file.name);
  const limit = image ? ATTACHMENT_LIMITS.imageBytes : ATTACHMENT_LIMITS.fileBytes;
  if (file.size <= limit) return null;
  return `${file.name} is ${formatFileSize(file.size)}. ${image ? 'An image' : 'A file'} can be up to ${formatFileSize(limit)}.`;
}
