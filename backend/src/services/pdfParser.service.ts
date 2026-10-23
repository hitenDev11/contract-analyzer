
import { PDFParse } from 'pdf-parse';

export const extractTextFromPDF = async (
  buffer: Buffer
): Promise<string> => {
  try {
    const parser = new PDFParse({ data: buffer });

    const result = await parser.getText();
    const text = result.text.trim();

    if (!text) {
      throw new Error('The PDF contains no extractable text');
    }

    return text;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    throw new Error(`PDF text extraction failed: ${message}`);
  }
};

export const splitIntoChunks = (
  text: string,
  chunkSize: number = 800,
  overlap: number = 100
): string[] => {
  if (chunkSize <= 0 || !Number.isInteger(chunkSize)) {
    throw new Error('chunkSize must be a positive integer');
  }

  if (
    overlap < 0 ||
    !Number.isInteger(overlap) ||
    overlap >= chunkSize
  ) {
    throw new Error(
      'overlap must be a non-negative integer smaller than chunkSize'
    );
  }

  const cleanedText = text.replace(/\s+/g, ' ').trim();

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < cleanedText.length) {
    const chunk = cleanedText.substring(
      startIndex,
      startIndex + chunkSize
    );

    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }

    const step = chunkSize - overlap;
    startIndex += step;
  }

  return chunks;
};