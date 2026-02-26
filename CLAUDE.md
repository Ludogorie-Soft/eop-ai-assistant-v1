# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered tender document generator MVP. Extracts text from CAIS (public procurement) pages or uploaded documents, uses LLM to rephrase introductions and match KSS (quantity bill) items to SMR (specification) templates, then exports to DOCX.

**Stack:** Next.js 15 (App Router), React 18, TypeScript, TailwindCSS, LangChain + OpenAI (gpt-4o-mini)

## Commands

```bash
npm run dev      # Start dev server at localhost:3000
npm run build    # Production build
npm run start    # Run production build
npm run lint     # ESLint
```

## Architecture

```
Frontend (React)          Backend (API Routes)           Libraries
─────────────────         ────────────────────           ─────────
HomePage.tsx              /api/cais                      caisFetcher.ts, caisPuppeteer.ts
  └── TenderSource        /api/parse-files               fileParser.ts (PDF/DOC/DOCX + OCR)
  └── RawExtractedText    /api/generate-introduction     introductionGenerator.ts
  └── Introduction        /api/generate-kss-smr          kssParser.ts, smrMatcher.ts
  └── KssSmrSection       /api/generate-docx             docxGenerator.ts
  └── GenerateDocxButton
```

**Data Flow:**
1. User provides source (CAIS URL or file upload)
2. Backend extracts text via HTML parsing, PDF extraction, or OCR fallback
3. User triggers AI generation → OpenAI creates rephrased introduction
4. Optional: Upload KSS Excel + SMR template → LLM matches items with confidence scores
5. DOCX export with all sections combined

## Key Technical Details

- **Server-side only AI:** OpenAI key accessed via `process.env.OPENAI_API_KEY` - never exposed to client
- **File processing chain:** pdf-parse → Tesseract.js OCR fallback (Bulgarian + English)
- **Optional Supabase:** For SPA rendering via Puppeteer and document storage
- **External packages:** Heavy deps (Puppeteer, pdf-parse, Tesseract) declared in `next.config.ts` as `serverExternalPackages`

## Environment Variables

```
OPENAI_API_KEY              # Required
SUPABASE_URL                # Optional - for SPA rendering
SUPABASE_ANON_KEY           # Optional
PUPPETEER_EXECUTABLE_PATH   # Optional - Chrome path override
GOOGLE_MAPS_API_KEY         # Optional - satellite images
```

## Directory Structure

- `/app/api/` - 5 API route handlers
- `/app/components/` - 5 React components (HomePage manages state)
- `/lib/` - Server-side utilities (~2,400 lines): file parsing, AI generation, DOCX export
- `/lib/prompts/` - LLM prompt templates
- `/scripts/` - Supabase setup SQL
