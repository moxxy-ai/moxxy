export interface ImagePreviewItem {
  readonly name: string;
  readonly mediaType: string;
  readonly base64: string;
  readonly byteLength?: number;
}

export function imagePreviewSrc(image: ImagePreviewItem): string {
  return `data:${image.mediaType};base64,${image.base64}`;
}
