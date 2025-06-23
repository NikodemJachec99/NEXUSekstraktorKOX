// src/utils/visionUtils.js
import vision from '@google-cloud/vision';

let client;
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    client = new vision.ImageAnnotatorClient();
  } else if (process.env.GOOGLE_CREDENTIALS) {
    const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64').toString('utf8'));
    client = new vision.ImageAnnotatorClient({ credentials });
  } else {
    throw new Error('Neither GOOGLE_APPLICATION_CREDENTIALS nor GOOGLE_CREDENTIALS environment variable is set');
  }
} catch (error) {
  console.error('Error initializing Vision client:', error);
  process.exit(1);
}
/**
 * detectTextInImageURL
 * - For a publicly accessible image URL
 */
export async function detectTextInImageURL(imageUrl) {
  try {
    const [result] = await client.textDetection(imageUrl);
    const fullTextAnnotation = result.fullTextAnnotation;
    return parseVisionAnnotation(fullTextAnnotation);
  } catch (error) {
    console.error('Error detecting text from URL:', error);
    return '';
  }
}

/**
 * detectTextInImageBuffer
 * - For an image buffer (from Multer file upload).
 *   We pass the base64 content to the Vision API.
 */
export async function detectTextInImageBuffer(imageBuffer, logPrefix = '') {
  try {
    // Log, o który prosiłeś:
    console.log(`${logPrefix} Używanie Google Vision API do detekcji tekstu (OCR)...`);
    
    const [result] = await client.textDetection({
      image: { content: imageBuffer.toString('base64') }
    });
    const fullTextAnnotation = result.fullTextAnnotation;
    
    const parsedText = parseVisionAnnotation(fullTextAnnotation);
    console.log(`${logPrefix} Vision API zakończyło pracę, wykryto ${parsedText.length} znaków.`);
    return parsedText;

  } catch (error) {
    console.error(`${logPrefix} Błąd podczas detekcji tekstu z bufora przez Vision API:`, error);
    return '';
  }
}

/**
 * parseVisionAnnotation
 * - Helper to parse the "fullTextAnnotation" object
 *   into a single multi-line string.
 */
function parseVisionAnnotation(fullTextAnnotation) {
  if (!fullTextAnnotation) {
    console.log('No text detected by Google Vision.');
    return '';
  }

  let formattedText = '';
  fullTextAnnotation.pages.forEach(page => {
    // console.log(page);
    page.blocks.forEach(block => {
      block.paragraphs.forEach(paragraph => {
        const paragraphText = paragraph.words
          .map(word => word.symbols.map(s => s.text).join(''))
          .join(' ');
        formattedText += paragraphText + '\n';
      });
      formattedText += '\n';
    });
  });
  return formattedText.trim();
}
