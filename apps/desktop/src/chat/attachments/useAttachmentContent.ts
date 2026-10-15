import { useContext, useEffect, useState } from 'react';
import type { UserPromptAttachment } from '@moxxy/sdk';
import { AttachmentReaderContext } from './AttachmentReaderContext';

/**
 * The attachment's payload: inline when the event carried it, otherwise read
 * back from the runner. `null` while reading, or when it cannot be read.
 */
export function useAttachmentContent(
  att: UserPromptAttachment,
  seq: number | undefined,
  index: number,
): string | null {
  const read = useContext(AttachmentReaderContext);
  const omitted = att.omittedBytes !== undefined;
  const [content, setContent] = useState<string | null>(omitted ? null : att.content);

  useEffect(() => {
    if (!omitted) {
      setContent(att.content);
      return;
    }
    setContent(null);
    if (!read || seq === undefined) return;
    let live = true;
    read(seq, index).then(
      (data) => {
        if (live) setContent(data);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [omitted, att.content, read, seq, index]);

  return content;
}
