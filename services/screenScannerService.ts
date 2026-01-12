import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger";
import { ACTIVITY_PARSER_MODEL } from "../constants";

export interface ScanResult {
  hasQuestion: boolean;
  question: string | null;
  rawText: string | null;
}

const SCAN_PROMPT = `Analyze this screenshot from an interview session.

Your task:
1. Look for any interview question displayed on screen
2. Interview questions are typically formatted as prompts asking about the candidate's experiences, opinions, motivations, or background

If you find an interview question:
- Return ONLY the question text, nothing else
- Clean up any formatting or line breaks

If there's no interview question visible (just a video call, chat interface without questions, or unrelated content):
- Return exactly: NO_QUESTION

Examples of interview questions to look for:
- "Why do you want to attend this medical school?"
- "Tell me about a time you showed leadership"
- "What is your greatest weakness?"
- "Describe a challenging situation you faced"

Remember: Return ONLY the question text or NO_QUESTION. No explanations or additional text.`;

export class ScreenScannerService {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = ACTIVITY_PARSER_MODEL; // gemini-3-flash-preview
  }

  /**
   * Capture screen and scan for interview questions
   */
  async scanScreen(): Promise<ScanResult> {
    logger.info("Starting screen scan...");

    try {
      // Capture screenshot
      const imageData = await this.captureScreen();

      if (!imageData) {
        logger.warn("Failed to capture screen");
        return { hasQuestion: false, question: null, rawText: null };
      }

      logger.info(`Screenshot captured: ${imageData.length} bytes`);

      // Send to Gemini for analysis
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: imageData
                }
              },
              { text: SCAN_PROMPT }
            ]
          }
        ]
      });

      const resultText = response.text?.trim() || '';
      logger.info(`Scan result: ${resultText.substring(0, 200)}`);

      if (resultText === 'NO_QUESTION' || resultText === '') {
        return { hasQuestion: false, question: null, rawText: resultText };
      }

      return {
        hasQuestion: true,
        question: resultText,
        rawText: resultText
      };

    } catch (error) {
      logger.error("Screen scan failed:", error);
      throw error;
    }
  }

  /**
   * Capture screenshot using getDisplayMedia
   */
  private async captureScreen(): Promise<string | null> {
    let stream: MediaStream | null = null;

    try {
      // Request screen capture (will use existing screen share if available)
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      // Create video element to capture frame
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          video.play().then(() => resolve()).catch(reject);
        };
        video.onerror = () => reject(new Error('Video load failed'));
      });

      // Wait a frame for video to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create canvas and capture frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      ctx.drawImage(video, 0, 0);

      // Convert to base64 JPEG
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64Data = dataUrl.split(',')[1];

      // Cleanup
      video.pause();
      video.srcObject = null;

      return base64Data;

    } finally {
      // Always stop the stream
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    }
  }

  /**
   * Analyze an existing image blob for questions
   * (for use with already captured video frames)
   */
  async analyzeImage(imageBase64: string): Promise<ScanResult> {
    logger.info("Analyzing image for questions...");

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: imageBase64
                }
              },
              { text: SCAN_PROMPT }
            ]
          }
        ]
      });

      const resultText = response.text?.trim() || '';
      logger.info(`Analysis result: ${resultText.substring(0, 200)}`);

      if (resultText === 'NO_QUESTION' || resultText === '') {
        return { hasQuestion: false, question: null, rawText: resultText };
      }

      return {
        hasQuestion: true,
        question: resultText,
        rawText: resultText
      };

    } catch (error) {
      logger.error("Image analysis failed:", error);
      throw error;
    }
  }
}
