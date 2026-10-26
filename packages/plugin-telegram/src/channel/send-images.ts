import { InputFile } from 'grammy';
import { imageUploads, type ImageUpload, type ImageUploadLimits } from '@moxxy/channel-kit';
import type { ToolImage } from '@moxxy/sdk';

/** The slice of grammy's `Api` sending a turn's images needs (the real client satisfies it). */
export interface TelegramImageSender {
  sendPhoto(chatId: number, photo: InputFile): Promise<unknown>;
  sendDocument(chatId: number, document: InputFile): Promise<unknown>;
  sendMediaGroup(chatId: number, media: ReadonlyArray<{ type: 'photo'; media: InputFile }>): Promise<unknown>;
  sendMessage(chatId: number, text: string, opts?: { parse_mode?: 'HTML' }): Promise<unknown>;
}

/**
 * An album holds 10 photos and a photo may be 10 MB; a turn sends its latest
 * 10 images. Bot API uploads are capped at 50 MB per request.
 */
export const TELEGRAM_IMAGE_LIMITS: ImageUploadLimits = {
  perMessage: 10,
  maxMessageBytes: 50_000_000,
  maxFileBytes: 10_000_000,
  maxImages: 10,
};

/** Types Telegram shows as a photo; any other image goes out as a file. */
const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export interface SendImagesLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Send the images tools returned in a turn under its reply: one as a photo,
 * several as an album, an image Telegram cannot show as a photo as a file.
 * A failed upload is logged and the rest still go; images left out (too many,
 * too large) are counted in one line.
 */
export async function sendToolImages(
  api: TelegramImageSender,
  chatId: number,
  images: ReadonlyArray<ToolImage>,
  logger?: SendImagesLogger,
): Promise<void> {
  const { batches, left } = imageUploads(images, TELEGRAM_IMAGE_LIMITS);
  for (const batch of batches) {
    try {
      if (batch.length > 1 && batch.every(isPhoto)) {
        await api.sendMediaGroup(chatId, batch.map((file) => ({ type: 'photo' as const, media: inputFile(file) })));
      } else {
        for (const file of batch) {
          if (isPhoto(file)) await api.sendPhoto(chatId, inputFile(file));
          else await api.sendDocument(chatId, inputFile(file));
        }
      }
    } catch (err) {
      logger?.warn('telegram image upload failed', { err: String(err) });
    }
  }
  if (left > 0) {
    try {
      await api.sendMessage(chatId, `<i>${left} more image${left === 1 ? '' : 's'} not sent (too many or too large).</i>`, {
        parse_mode: 'HTML',
      });
    } catch (err) {
      logger?.warn('telegram image note failed', { err: String(err) });
    }
  }
}

function isPhoto(file: ImageUpload): boolean {
  return PHOTO_TYPES.has(file.mediaType);
}

function inputFile(file: ImageUpload): InputFile {
  return new InputFile(file.bytes, file.name);
}
