import { describe, expect, it } from 'vitest';
import {
  buildPromptAttachment,
  estimateBase64Bytes,
  MAX_MOBILE_ATTACHMENT_BYTES,
  summarizeAttachment,
  validateAttachmentBytes,
} from '../attachments';

describe('mobile prompt attachments', () => {
  it('builds image, document, and text attachments in the SDK prompt format', () => {
    expect(buildPromptAttachment({
      content: 'AQID',
      mediaType: 'image/png',
      name: 'screen.png',
    })).toEqual({
      kind: 'image',
      content: 'AQID',
      mediaType: 'image/png',
      name: 'screen.png',
    });

    expect(buildPromptAttachment({
      content: 'JVBERi0=',
      mediaType: 'application/pdf',
      name: 'report.pdf',
    })).toEqual({
      kind: 'document',
      content: 'JVBERi0=',
      mediaType: 'application/pdf',
      name: 'report.pdf',
    });

    expect(buildPromptAttachment({
      content: 'hello from phone',
      mediaType: 'text/plain',
      name: 'notes.txt',
      text: true,
    })).toEqual({
      kind: 'file',
      content: 'hello from phone',
      name: 'notes.txt',
      mediaType: 'text/plain',
    });
  });

  it('estimates base64 payload size and blocks oversized inline uploads', () => {
    expect(estimateBase64Bytes('AQID')).toBe(3);
    expect(validateAttachmentBytes({ name: 'ok.png', bytes: 1024 })).toBeNull();
    expect(validateAttachmentBytes({ name: 'huge.mov', bytes: 9 * 1024 * 1024 })).toContain('huge.mov');
  });

  it('caps inline mobile attachments at 8 MB', () => {
    expect(MAX_MOBILE_ATTACHMENT_BYTES).toBe(8 * 1024 * 1024);
    expect(validateAttachmentBytes({ name: 'edge.bin', bytes: MAX_MOBILE_ATTACHMENT_BYTES })).toBeNull();
    expect(validateAttachmentBytes({ name: 'edge.bin', bytes: MAX_MOBILE_ATTACHMENT_BYTES + 1 })).toContain('8 MB');
  });

  it('summarizes chips for the composer without leaking base64 content', () => {
    expect(summarizeAttachment({
      kind: 'image',
      content: 'AQID',
      mediaType: 'image/png',
      name: 'screen.png',
    })).toEqual({
      label: 'screen.png',
      detail: 'Image',
    });
  });
});
