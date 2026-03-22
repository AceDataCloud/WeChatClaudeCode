import type { MessageItem } from './types.js';
import { MessageItemType } from './types.js';
import { downloadAndDecrypt } from './cdn.js';
import { logger } from '../logger.js';

function detectMimeType(data: Buffer): string {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0xFF && data[1] === 0xD8) return 'image/jpeg';
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif';
  if (data[0] === 0x52 && data[1] === 0x49) return 'image/webp';
  if (data[0] === 0x42 && data[1] === 0x4D) return 'image/bmp';
  return 'image/jpeg'; // fallback
}

/**
 * Download a CDN image, decrypt it, and return a base64 data URI.
 * Returns null on failure.
 */
export async function downloadImage(item: MessageItem): Promise<string | null> {
  const cdnMedia = item.image_item?.cdn_media;
  if (!cdnMedia) {
    return null;
  }

  try {
    const decrypted = await downloadAndDecrypt(cdnMedia.encrypt_query_param, cdnMedia.aes_key);
    const mimeType = detectMimeType(decrypted);
    const base64 = decrypted.toString('base64');
    const dataUri = `data:${mimeType};base64,${base64}`;
    logger.info('Image downloaded and decrypted', { size: decrypted.length });
    return dataUri;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to download image', { error: msg });
    return null;
  }
}

/**
 * Extract text content from a message item.
 * Returns text_item.text or empty string.
 */
export function extractText(item: MessageItem): string {
  return item.text_item?.text ?? '';
}

/**
 * Find the first IMAGE type item in a list.
 */
export function extractFirstImageUrl(items?: MessageItem[]): MessageItem | undefined {
  return items?.find((item) => item.type === MessageItemType.IMAGE);
}
