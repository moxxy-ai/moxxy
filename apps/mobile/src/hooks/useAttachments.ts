import { useCallback, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import {
  buildPromptAttachment,
  estimateBase64Bytes,
  inferMediaType,
  isTextAttachmentMediaType,
  stripDataUrlPrefix,
  validateAttachmentBytes,
  type PromptAttachment,
} from '../attachments';

const ERROR_RESET_MS = 3000;

export function useAttachments(options: { readonly disabled?: boolean } = {}) {
  const [attachments, setAttachments] = useState<ReadonlyArray<PromptAttachment>>([]);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((message: string) => {
    setError(message);
    setTimeout(() => setError(null), ERROR_RESET_MS);
  }, []);

  const addAttachment = useCallback((attachment: PromptAttachment) => {
    setAttachments((current) => {
      const duplicate = current.some((item) =>
        item.kind === attachment.kind &&
        item.name === attachment.name &&
        item.mediaType === attachment.mediaType &&
        item.content === attachment.content,
      );
      return duplicate ? current : [...current, attachment];
    });
  }, []);

  const pickImage = useCallback(async () => {
    if (options.disabled) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: false,
        base64: true,
        quality: 0.92,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0]!;
      const content = asset.base64 ?? await readBase64(asset.uri);
      const bytes = asset.fileSize ?? estimateBase64Bytes(content);
      const tooLarge = validateAttachmentBytes({ name: asset.fileName ?? 'image', bytes });
      if (tooLarge) {
        fail(tooLarge);
        return;
      }
      addAttachment(buildPromptAttachment({
        content,
        mediaType: asset.mimeType ?? inferMediaType(asset.fileName) ?? 'image/jpeg',
        name: asset.fileName ?? 'image.jpg',
      }));
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not attach image.');
    }
  }, [addAttachment, fail, options.disabled]);

  const pickDocument = useCallback(async () => {
    if (options.disabled) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0]!;
      const mediaType = asset.mimeType ?? inferMediaType(asset.name);
      const name = asset.name || 'attachment';
      if (isTextAttachmentMediaType(mediaType)) {
        addAttachment(buildPromptAttachment({
          content: await readText(asset),
          mediaType,
          name,
          text: true,
        }));
        return;
      }
      if (mediaType?.startsWith('image/') || mediaType === 'application/pdf') {
        const content = asset.base64 ?? await readBase64(asset.uri);
        const bytes = asset.size ?? estimateBase64Bytes(content);
        const tooLarge = validateAttachmentBytes({ name, bytes });
        if (tooLarge) {
          fail(tooLarge);
          return;
        }
        addAttachment(buildPromptAttachment({ content, mediaType, name }));
        return;
      }
      fail('Only images, PDFs, and text files can be attached from mobile right now.');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not attach file.');
    }
  }, [addAttachment, fail, options.disabled]);

  const pasteImage = useCallback(async () => {
    if (options.disabled) return;
    try {
      const image = await Clipboard.getImageAsync({ format: 'png' });
      if (!image) {
        fail('No image found in clipboard.');
        return;
      }
      const content = stripDataUrlPrefix(image.data);
      const tooLarge = validateAttachmentBytes({ name: 'clipboard-image.png', bytes: estimateBase64Bytes(content) });
      if (tooLarge) {
        fail(tooLarge);
        return;
      }
      addAttachment(buildPromptAttachment({
        content,
        mediaType: 'image/png',
        name: 'clipboard-image.png',
      }));
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not paste image.');
    }
  }, [addAttachment, fail, options.disabled]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  return {
    attachments,
    attachmentError: error,
    pickImage,
    pickDocument,
    pasteImage,
    removeAttachment,
    clearAttachments,
  };
}

async function readBase64(uri: string): Promise<string> {
  return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

async function readText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (asset.file && typeof asset.file.text === 'function') return await asset.file.text();
  return await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
}
