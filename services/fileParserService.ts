import { GoogleGenAI, createPartFromUri, createUserContent } from '@google/genai';
import { logger } from './logger';

export class FileParserService {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * Upload file to Gemini and extract text
   */
  async parseFile(file: File): Promise<string> {
    // Validate file
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext || '')) {
      throw new Error(`Unsupported file type: .${ext}`);
    }

    // File size limit: 50MB
    if (file.size > 50 * 1024 * 1024) {
      throw new Error('File too large. Maximum size is 50MB.');
    }

    logger.info(`Uploading file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

    try {
      // Upload file to Gemini
      const uploadedFile = await this.ai.files.upload({
        file: file, // File object from <input type="file">
        config: {
          displayName: file.name,
        },
      });

      logger.info(`File uploaded: ${uploadedFile.uri}`);

      // Wait for processing (file might need time to be ready)
      await this.waitForFileProcessing(uploadedFile.name);

      // Extract text using Gemini
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: createUserContent([
          createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
          "Extract all text from this document. Preserve formatting, bullet points, and paragraph breaks. Return only the extracted text with no additional commentary.",
        ]),
      });

      const extractedText = response.text || '';
      logger.info(`Text extracted: ${extractedText.length} characters`);

      // Clean up: delete file from Gemini
      await this.ai.files.delete({ name: uploadedFile.name });
      logger.info('File deleted from Gemini');

      return extractedText;

    } catch (error) {
      logger.error('File parsing failed:', error);
      throw new Error(`Failed to parse file: ${(error as Error).message}`);
    }
  }

  /**
   * Wait for file to be processed by Gemini
   */
  private async waitForFileProcessing(fileName: string, maxRetries = 10): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      const fileInfo = await this.ai.files.get({ name: fileName });

      if (fileInfo.state === 'ACTIVE') {
        return; // File ready
      }

      if (fileInfo.state === 'FAILED') {
        throw new Error('File processing failed');
      }

      // Wait 1 second before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('File processing timeout');
  }
}
