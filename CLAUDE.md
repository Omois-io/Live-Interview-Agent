# Claude Code Instructions for Live Interview Agent

## Auto-Build & Release Workflow

When the user says "ship it", "build it", "release", or similar:

1. **Build the app:**
   ```bash
   npm run dist:win
   ```

2. **Copy to Windows:**
   ```bash
   rm -rf /mnt/c/Interview-HUD && cp -r release/win-unpacked /mnt/c/Interview-HUD
   ```

3. **Create GitHub release** (if user wants to publish):
   ```bash
   # Tag and push
   git tag -a v1.x.x -m "Release v1.x.x"
   git push origin v1.x.x

   # Create release with assets
   gh release create v1.x.x release/win-unpacked --title "v1.x.x" --notes "Release notes here"
   ```

## Files to NEVER commit

- `.env` - Contains API keys
- `Interview_questions_answers/` - Personal interview answers
- `release/` - Build artifacts (use GitHub releases instead)
- `out/` - Build output

## Project Structure

- `services/` - Core services (Gemini, embeddings, RAG)
- `components/` - React UI components
- `constants.ts` - Model configuration (EMBEDDING_MODEL, ACTIVITY_PARSER_MODEL)
- `electron/` - Electron main process

## Model Configuration

Edit `constants.ts` to change models:
- `EMBEDDING_MODEL` - For semantic search
- `ACTIVITY_PARSER_MODEL` - For parsing activities
- `MODEL_NAME` - For live audio/video
