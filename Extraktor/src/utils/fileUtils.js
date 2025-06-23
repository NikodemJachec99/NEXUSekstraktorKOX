// src/utils/fileUtils.js
import axios from 'axios';
import { fileTypeFromBuffer } from 'file-type';

/**
 * Download a file from a URL into a Buffer
 */
export async function downloadUrlToBuffer(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data, 'binary');
}

/**
 * Detect MIME type from a buffer
 */
export async function detectFileType(buffer) {
  const result = await fileTypeFromBuffer(buffer);
  return result ? result.mime : 'application/octet-stream';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function downloadWithRetry(url, retries = 3, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const buffer = await downloadUrlToBuffer(url);
      // if (!isValidPdfBuffer(buffer)) throw new Error('Downloaded PDF buffer invalid');
      return buffer;
    } catch (err) {
      console.error(`Attempt ${attempt} failed for ${url}:`, err.message);
      if (attempt === retries) throw err;
      await sleep(delayMs);
    }
  }
}


export function isValidPdfBuffer(buffer) {
  const str = buffer.toString('utf8', 0, 1000); // Check first 1000 bytes
  return str.includes('%PDF');
}


