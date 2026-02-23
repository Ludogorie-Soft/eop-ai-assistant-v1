# Tender Technical Generator – MVP v1

Production-ready MVP web application for generating Tender Technical documents. Uses AI (LangChain + OpenAI) to generate the Introduction section from CAIS links or uploaded tender documents.

## Stack

- **Frontend:** Next.js 15 App Router, React, TypeScript, TailwindCSS
- **Backend:** Next.js API Routes (Route Handlers)
- **AI:** LangChain, OpenAI (server-side only)
- **Document processing:** docx, pdf-parse, mammoth

## Features

- **CAIS ingestion** – Fetch and extract text from public procurement pages (cais.bg, eop.bg, app.eop.bg)
- **Puppeteer + Supabase** (when configured) – Renders SPA pages (e.g. app.eop.bg), extracts PDF/DOC/DOCX links, downloads them, stores in Supabase Storage, extracts text
- **Fallback** – Without Supabase: simple fetch + HTML link parsing (works for static pages)
- **File upload** – PDF, DOC and DOCX extraction (multiple files)
- **AI Introduction** – LangChain + OpenAI generation with strict rephrasing rules
- **DOCX export** – Download `tender_technical.docx` with formatted Introduction

## Project structure

```
├── app/
│   ├── api/                    # Next.js API Route Handlers
│   │   ├── cais/route.ts
│   │   ├── parse-files/route.ts
│   │   ├── generate-introduction/route.ts
│   │   └── generate-docx/route.ts
│   ├── components/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── lib/                        # Shared server-side utilities
│   ├── caisFetcher.ts
│   ├── caisPuppeteer.ts
│   ├── fileParser.ts
│   ├── langchainClient.ts
│   ├── introductionGenerator.ts
│   ├── docxGenerator.ts
│   ├── filenameEncoding.ts
│   └── prompts/
├── scripts/
├── next.config.ts
├── tailwind.config.js
└── package.json
```

## Installation

### 1. Clone and install dependencies

```bash
cd eop-ai-assistant-v1
npm install
```

### 2. Environment variables

Create a `.env.local` file in the project root (Next.js loads this automatically):

```env
OPENAI_API_KEY=sk-your-openai-api-key

# For automatic CAIS document fetch (Puppeteer + Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

**Required:**
- `OPENAI_API_KEY` – OpenAI API key for LangChain/LLM calls (server-side only, never exposed to client)

**For CAIS automatic document fetch (Puppeteer + Storage):**
- `SUPABASE_URL` – Supabase project URL
- `SUPABASE_ANON_KEY` – Anon key (run `scripts/supabase-storage-policies.sql` for access)

Create bucket `tender-documents` in Supabase Dashboard (Storage → New bucket) or run `scripts/setup-supabase-bucket.sql` in SQL Editor.

**macOS:** If you see "macOS Prevented ... from modifying", grant **Full Disk Access** or **Automation** to Terminal/Cursor in System Settings → Privacy & Security. Or run `npm run dev` from the system Terminal (outside Cursor).

### 3. Run locally

**Development:**

```bash
npm run dev
```

Starts Next.js dev server at http://localhost:3000 (frontend + API routes under `/api`).

**Production build:**

```bash
npm run build
npm run start
```

Serves the built app at http://localhost:3000.

## Usage flow

1. **Tender source**
   - Enter a CAIS URL and click **Fetch from CAIS**, or
   - Upload PDF/DOC/DOCX files (multiple allowed)

2. **Raw extracted text**
   - Merged text from CAIS and uploaded files appears in the readonly textarea

3. **Introduction**
   - Click **Generate Introduction (AI)** to create the Introduction from the extracted text
   - Edit the generated text if needed

4. **Export**
   - Click **Generate DOCX** to download `tender_technical.docx`

## Security

- CAIS URL validation (only cais.bg, eop.bg, opendata.cais.bg)
- File size limit: 10MB per file
- Only PDF, DOC and DOCX allowed
- OpenAI API key used only on the server

## Future sections (not in MVP)

- Technology
- Team
- Communication
