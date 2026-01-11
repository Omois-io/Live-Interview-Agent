# Live Interview Agent

Real-time AI-powered interview coaching for medical school applicants. Uses Gemini 2.5 Flash with native audio/video to provide instant answer suggestions during MMI and traditional interviews.

## Download

**[Download for Windows](https://github.com/Omois-io/Live-Interview-Agent/releases/latest)** | **[Download for Mac](https://github.com/Omois-io/Live-Interview-Agent/releases/latest)**

Get your Gemini API key at [ai.google.dev](https://ai.google.dev/)

## Features

- **Real-time Audio Processing** - Captures interviewer questions via system audio and microphone
- **Video Support** - Reads questions displayed on screen (MMI-style interviews)
- **Q&A Cheat Sheet** - Pre-loaded answers matched via semantic search
- **RAG System** - Retrieves relevant context from your CV and 15 AMCAS activities
- **LLM Activity Parsing** - Automatically structures your activities for better retrieval
- **Live Answer Generation** - Generates personalized answers for unexpected questions

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` file with your Gemini API key:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```

3. Run in development:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   ```

## Usage

1. **Add your API key** - Enter your Gemini API key on first launch
2. **Set up your background** - Click "Edit CV & Activities" to add your personal statement and 15 activities
3. **Configure Q&A** - Add/edit your prepared answers in the Questions tab
4. **Start session** - Select audio sources and click Connect
5. **Interview** - The agent listens and provides real-time answer suggestions

## Configuration

Model settings in `constants.ts`:
- `EMBEDDING_MODEL` - Gemini embedding model for semantic search
- `ACTIVITY_PARSER_MODEL` - Model for parsing activities into structured format
- `MODEL_NAME` - Live audio/video model

## Tech Stack

- Electron + React + TypeScript
- Gemini 2.5 Flash Native Audio API
- Gemini Embeddings for semantic search
- Vite + electron-vite

## License

MIT
