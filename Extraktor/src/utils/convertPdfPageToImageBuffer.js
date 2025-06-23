import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
const execAsync = promisify(exec);

// Add poppler bin directory to PATH
const POPPLER_PATH = 'C:\\tools\\poppler-24.08.0\\Library\\bin';
process.env.PATH = `${POPPLER_PATH};${process.env.PATH}`;

/**
 * Writes a buffer to a temporary file with the given extension.
 * Returns the file path.
 */
async function writeBufferToTempFile(buffer, extension) {
  const tmpDir = os.tmpdir();
  const filename = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${extension}`;
  const filePath = path.join(tmpDir, filename);
  await fsPromises.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Uses pdftocairo to convert the specified page of the PDF at pdfPath into a PNG.
 * Returns the full path of the generated image.
 */
async function convertPdfPageToImage(pdfPath, outputDir, pageNumber) {
  const outPrefix = path.basename(pdfPath, path.extname(pdfPath));
  const outputFile = path.join(outputDir, `${outPrefix}`);
const PDFTOCAIRO_PATH = 'C:\\tools\\poppler-24.08.0\\Library\\bin\\pdftocairo.exe';
const command = `"${PDFTOCAIRO_PATH}" -png -r 330 -f ${pageNumber} -l ${pageNumber} -scale-to-x 1086 -scale-to-y -1 "${pdfPath}" "${outputFile}"`;
  // console.log("Running command:", command);
  const { stdout, stderr } = await execAsync(command);
  if (stderr) {
    console.log('pdftocairo stderr:', stderr);
  }
  const generatedFileName = `${outPrefix}-${pageNumber}.png`;
  return path.join(outputDir, generatedFileName);
}

/**
 * Converts the first page of a PDF (provided as a buffer) to an image buffer.
 */
export async function convertPdfPageToImageBuffer(pdfBuffer) {
  // Write the PDF buffer to a temporary file
  const pdfTempPath = await writeBufferToTempFile(pdfBuffer, 'pdf');
  // Create a temporary output directory
  const tmpDir = os.tmpdir();
  const outputDir = path.join(tmpDir, `pdf_output_${Date.now()}_${Math.random().toString(36).substring(2,15)}`);
  await fsPromises.mkdir(outputDir, { recursive: true });
  
  try {
    // Convert page 1 of the PDF to image using pdftocairo
    const imagePath = await convertPdfPageToImage(pdfTempPath, outputDir, 1);
    const imageBuffer = await fsPromises.readFile(imagePath);
    // Cleanup temporary files
    await fsPromises.unlink(pdfTempPath);
    await fsPromises.unlink(imagePath);
    return imageBuffer;
  } catch (error) {
    // Cleanup on error
    await fsPromises.unlink(pdfTempPath);
    throw error;
  }
}

/**
 * Converts all pages of a PDF (provided as a buffer) to image buffers.
 * No need to pass number of pages — uses pdftocairo to auto-generate them all.
 */
export async function convertPdfToAllImageBuffers(pdfBuffer) {
  const pdfTempPath = await writeBufferToTempFile(pdfBuffer, 'pdf');
  const tmpDir = os.tmpdir();
  const outputDir = path.join(tmpDir, `pdf_output_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`);
  await fsPromises.mkdir(outputDir, { recursive: true });

  try {
    const outputPrefix = path.join(outputDir, 'page');
    const PDFTOCAIRO_PATH = 'C:\\tools\\poppler-24.08.0\\Library\\bin\\pdftocairo.exe';
    const command = `"${PDFTOCAIRO_PATH}" -png -r 330 -scale-to-x 1086 -scale-to-y -1 "${pdfTempPath}" "${outputPrefix}"`;
    // console.log('Running:', command);
    await execAsync(command);

    const files = await fsPromises.readdir(outputDir);
    const imageFiles = files
      .filter(f => f.endsWith('.png'))
      .map(f => path.join(outputDir, f))
      .sort(); // Ensures page-1, page-2, ...

    const buffers = [];
    for (const imagePath of imageFiles) {
      const buf = await fsPromises.readFile(imagePath);
      buffers.push(buf);
      await fsPromises.unlink(imagePath); // cleanup
    }

    await fsPromises.unlink(pdfTempPath);
    return buffers;

  } catch (error) {
    await fsPromises.unlink(pdfTempPath).catch(() => {});
    throw error;
  }
}
