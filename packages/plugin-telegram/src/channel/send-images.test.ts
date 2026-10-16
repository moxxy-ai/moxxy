import { describe, expect, it } from 'vitest';
import type { InputFile } from 'grammy';
import { sendToolImages, type TelegramImageSender } from './send-images.js';

function recordingApi(): { api: TelegramImageSender; calls: string[] } {
  const calls: string[] = [];
  const api: TelegramImageSender = {
    sendPhoto: async (_chatId, photo) => {
      calls.push(`photo ${photo.filename}`);
    },
    sendDocument: async (_chatId, document) => {
      calls.push(`document ${document.filename}`);
    },
    sendMediaGroup: async (_chatId, media) => {
      calls.push(`album ${media.map((item) => (item.media as InputFile).filename).join(',')}`);
    },
    sendMessage: async (_chatId, text) => {
      calls.push(`text ${text}`);
    },
  };
  return { api, calls };
}

const png = { mediaType: 'image/png', base64: Buffer.from('a').toString('base64') };
const jpeg = { mediaType: 'image/jpeg', base64: Buffer.from('b').toString('base64') };

describe('sendToolImages', () => {
  it('sends one image as a photo', async () => {
    const { api, calls } = recordingApi();
    await sendToolImages(api, 1, [png]);
    expect(calls).toEqual(['photo image-1.png']);
  });

  it('sends several images as one album', async () => {
    const { api, calls } = recordingApi();
    await sendToolImages(api, 1, [png, jpeg]);
    expect(calls).toEqual(['album image-1.png,image-2.jpg']);
  });

  it('sends an image Telegram does not show as a photo as a file', async () => {
    const { api, calls } = recordingApi();
    await sendToolImages(api, 1, [png, { mediaType: 'image/gif', base64: 'AAAA' }]);
    expect(calls).toEqual(['photo image-1.png', 'document image-2.gif']);
  });

  it('says how many images were left out', async () => {
    const { api, calls } = recordingApi();
    const many = Array.from({ length: 12 }, (_, i) => ({ mediaType: 'image/png', base64: Buffer.from(`i${i}`).toString('base64') }));
    await sendToolImages(api, 1, many);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe('text <i>2 more images not sent (too many or too large).</i>');
  });

  it('logs a failed upload and goes on', async () => {
    const { api, calls } = recordingApi();
    const warnings: string[] = [];
    await sendToolImages(
      { ...api, sendMediaGroup: async () => Promise.reject(new Error('flood')) },
      1,
      [png, jpeg],
      { warn: (msg) => warnings.push(msg) },
    );
    expect(calls).toEqual([]);
    expect(warnings).toEqual(['telegram image upload failed']);
  });
});
