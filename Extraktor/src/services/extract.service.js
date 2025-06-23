import { downloadWithRetry, detectFileType } from '../utils/fileUtils.js';
import { callOpenAI, callOpenAIJson } from '../utils/aiUtils.js';
import { convertPdfToAllImageBuffers } from '../utils/convertPdfPageToImageBuffer.js';
import {
  detectTextInImageURL,
  detectTextInImageBuffer
} from '../utils/visionUtils.js';
import pdfParse from 'pdf-parse';

/**
 * handleExtraction
 *
 * - Gathers text from:
 *   (a) "text" inputs
 *   (b) image inputs (via Vision)
 *   (c) PDF inputs (via pdf-parse or OCR fallback)
 * - Formats them all into one final message, with 'prompt' on top,
 *   then each piece separated by '-----'.
 */
export async function handleExtraction(prompt = '', inputs = [], fileUploads = [], json_schema, model) {
  const extractedItems = [];

  // 1. Process JSON-based "inputs" (text, image URLs, or PDF URLs)
  for (const input of inputs) {
    if (input.type === 'text') {
      extractedItems.push({
        label: 'Text',
        content: input.content || ''
      });

    } else if (input.type === 'url') {
      const urls = input.content
        .split(',')
        .map(url => url.trim())
        .filter(url => url && url.startsWith('http'));

      let combinedPdfText = '';

      for (const url of urls) {
        try {
          console.log('Processing URL:', url);
          const buffer = await downloadWithRetry(url);
          const mimeType = await detectFileType(buffer);
          console.log(`Detected MIME type: ${mimeType} for URL: ${url}`);

          if (mimeType.startsWith('image/')) {
            const visionText = await detectTextInImageURL(url);
            extractedItems.push({
              label: `Image URL: ${url}`,
              content: visionText || ''
            });

          } else if (mimeType === 'application/pdf') {
            try {
              const pdfData = await pdfParse(buffer);

              if (pdfData.text.trim()) {
                combinedPdfText += pdfData.text;
              } else {
                console.log('PDF had no text, converting all pages to image for OCR...');
                const imageBuffers = await convertPdfToAllImageBuffers(buffer);
                for (const imageBuffer of imageBuffers) {
                  const visionText = await detectTextInImageBuffer(imageBuffer);
                  combinedPdfText += visionText || '';
                }
              }

            } catch (pdfError) {
              console.error(`PDF parse error for URL: ${url}`, pdfError);
              const imageBuffers = await convertPdfToAllImageBuffers(buffer);
              for (const imageBuffer of imageBuffers) {
                const visionText = await detectTextInImageBuffer(imageBuffer);
                combinedPdfText += visionText || '';
              }
            }

          } else {
            console.warn(`Unsupported MIME type: ${mimeType} for URL: ${url}`);
          }
        } catch (error) {
          console.error(`Failed to process ${url}:`, error);
        }
      }

      if (combinedPdfText) {
        extractedItems.push({
          label: 'Combined PDF Text',
          content: combinedPdfText
        });
      }

    } else {
      extractedItems.push({
        label: `Unknown Input Type: ${input.type}`,
        content: ''
      });
    }
  }

  // 2. Process uploaded files (via Multer)
  for (const file of fileUploads) {
    const mimeType = file.mimetype;
    const originalName = file.originalname || 'Uploaded File';
    console.log(`Processing uploaded file: ${originalName}, MIME: ${mimeType}`);

    try {
      if (mimeType.startsWith('image/')) {
        const visionText = await detectTextInImageBuffer(file.buffer);
        extractedItems.push({
          label: `Image File: ${originalName}`,
          content: visionText || ''
        });

      } else if (mimeType === 'application/pdf') {
        try {
          const pdfData = await pdfParse(file.buffer);

          if (pdfData.text.trim()) {
            extractedItems.push({
              label: `PDF File: ${originalName}`,
              content: pdfData.text
            });
          } else {
            console.log('Uploaded PDF had no text, converting all pages to image for OCR...');
            const imageBuffers = await convertPdfToAllImageBuffers(file.buffer);
            let fullVisionText = '';
            for (const imageBuffer of imageBuffers) {
              const visionText = await detectTextInImageBuffer(imageBuffer);
              fullVisionText += visionText || '';
            }
            extractedItems.push({
              label: `PDF OCR: ${originalName}`,
              content: fullVisionText
            });
          }

        } catch (pdfError) {
          console.error(`PDF parse error for uploaded file: ${originalName}`, pdfError);
          const imageBuffers = await convertPdfToAllImageBuffers(file.buffer);
          let fullVisionText = '';
          for (const imageBuffer of imageBuffers) {
            const visionText = await detectTextInImageBuffer(imageBuffer);
            fullVisionText += visionText || '';
          }
          extractedItems.push({
            label: `PDF OCR: ${originalName}`,
            content: fullVisionText
          });
        }

      } else {
        extractedItems.push({
          label: `Unsupported File Type: ${originalName} (${mimeType})`,
          content: ''
        });
      }

    } catch (error) {
      console.error(`Failed to process uploaded file: ${originalName}`, error);
    }
  }

  // 3. Build final content for AI
  let finalContent = `${prompt}\n\n`;

  extractedItems.forEach((item) => {
    finalContent += `-----\n${item.label} content:\n${item.content}\n`;
  });

  // console.log('Final content prepared for AI:');
  // console.log(finalContent);

  // 4. Call OpenAI
  if (json_schema != null) {
    console.log('Using structured response with JSON schema.');
    const aiResponse = await callOpenAIJson(finalContent, json_schema, model);
    console.log('AI Response:', aiResponse);
    return aiResponse;
  } else {
    const aiResponse = await callOpenAI(finalContent, model);
    return aiResponse;
  }
}
