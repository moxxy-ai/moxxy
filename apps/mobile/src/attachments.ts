/**
 * Inline prompt-attachment helpers for the composer.
 *
 * `PromptAttachment` here is the SDK's `UserPromptAttachment` (`@moxxy/sdk`
 * events.ts) — `{ kind: 'stdin'|'file'|'image'|'document'|'audio', content,
 * name?, mediaType? }` — i.e. the inline shape `user_prompt` events carry and
 * the shape this module builds from the pickers/clipboard. NOTE for the data
 * layer: our desktop IPC contract's `session.runTurn` does NOT take inline
 * attachments — it takes `{ path, name }` records (host file paths). A remote
 * client must first persist each inline payload via
 * `session.saveImageAttachment({ dataBase64, mediaType, name })` (allowed over
 * the WS bridge precisely for this) and pass the returned `{ path, name }` to
 * `session.runTurn`.
 */

import type { UserPromptAttachment } from '@moxxy/sdk';

export type PromptAttachment = UserPromptAttachment;

export interface BuildPromptAttachmentInput {
  readonly content: string;
  readonly mediaType?: string | null;
  readonly name?: string | null;
  readonly text?: boolean;
}

export interface AttachmentSummary {
  readonly label: string;
  readonly detail: string;
}

export const MAX_MOBILE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function buildPromptAttachment(input: BuildPromptAttachmentInput): PromptAttachment {
  const mediaType = normalizeMediaType(input.mediaType);
  const name = normalizeName(input.name, mediaType);
  if (input.text) {
    return {
      kind: 'file',
      content: input.content,
      name,
      ...(mediaType ? { mediaType } : {}),
    };
  }
  if (mediaType?.startsWith('image/')) {
    return { kind: 'image', content: input.content, mediaType, name };
  }
  if (mediaType === 'application/pdf') {
    return { kind: 'document', content: input.content, mediaType, name };
  }
  return {
    kind: 'file',
    content: input.content,
    name,
    ...(mediaType ? { mediaType } : {}),
  };
}

export function estimateBase64Bytes(base64: string): number {
  const clean = base64.trim().replace(/^data:[^,]+,/, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function validateAttachmentBytes(input: { readonly name?: string | null; readonly bytes: number }): string | null {
  if (input.bytes <= MAX_MOBILE_ATTACHMENT_BYTES) return null;
  const mb = Math.round(MAX_MOBILE_ATTACHMENT_BYTES / (1024 * 1024));
  return `${input.name ?? 'Attachment'} is too large to attach from mobile (max ${mb} MB).`;
}

export function summarizeAttachment(attachment: PromptAttachment): AttachmentSummary {
  return {
    label: attachment.name ?? fallbackName(attachment),
    detail: attachment.kind === 'image'
      ? 'Image'
      : attachment.kind === 'document'
        ? 'Document'
        : attachment.mediaType?.startsWith('text/')
          ? 'Text'
          : 'File',
  };
}

export function inferMediaType(name: string | null | undefined): string | undefined {
  const ext = name?.trim().toLowerCase().split('.').pop();
  if (!ext) return undefined;
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'pdf') return 'application/pdf';
  if (['txt', 'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'css', 'html', 'xml', 'csv', 'log', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'sql', 'yml', 'yaml'].includes(ext)) {
    return 'text/plain';
  }
  return undefined;
}

export function isTextAttachmentMediaType(mediaType: string | null | undefined): boolean {
  const normalized = normalizeMediaType(mediaType);
  return Boolean(
    normalized?.startsWith('text/') ||
    normalized === 'application/json' ||
    normalized === 'application/xml' ||
    normalized === 'application/x-yaml',
  );
}

export function stripDataUrlPrefix(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma >= 0 ? value.slice(comma + 1) : value;
}

function normalizeMediaType(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeName(value: string | null | undefined, mediaType: string | undefined): string {
  const trimmed = value?.trim();
  if (trimmed && trimmed.length > 0) return trimmed.slice(0, 160);
  return fallbackName({ kind: mediaType?.startsWith('image/') ? 'image' : mediaType === 'application/pdf' ? 'document' : 'file', mediaType });
}

function fallbackName(attachment: Pick<PromptAttachment, 'kind' | 'mediaType'>): string {
  if (attachment.kind === 'image') {
    if (attachment.mediaType === 'image/jpeg') return 'image.jpg';
    if (attachment.mediaType === 'image/webp') return 'image.webp';
    return 'image.png';
  }
  if (attachment.kind === 'document') return 'document.pdf';
  return 'attachment.txt';
}
