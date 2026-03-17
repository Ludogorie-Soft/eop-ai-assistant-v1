# Tender Technical Generator – MVP v1

Web application for generating Tender Technical documents. Uses AI (LangChain + OpenAI) to generate introduction, team organization, and KSS/SMR sections from uploaded tender documents, then exports to DOCX.

## Stack

- **Frontend:** Next.js 15 App Router, React, TypeScript, TailwindCSS
- **Backend:** Next.js API Routes (Route Handlers)
- **AI:** LangChain, OpenAI (server-side only)
- **Storage:** Supabase (tenders, templates, offers)
- **Document processing:** docx, pdf-parse, mammoth, xlsx, Tesseract.js (OCR)

## Features

- **File upload** – PDF and DOCX extraction (multiple files, OCR fallback)
- **AI Introduction** – LangChain + OpenAI generation with strict rephrasing rules
- **KSS → SMR** – Upload KSS Excel + SMR templates; LLM matches each KSS position to an SMR block with confidence scores
- **Team Organization** – AI-generated team/staffing section based on extracted positions and templates
- **Communication section** – AI-generated "Комуникация" section covering communication 
- **Standards extraction** – Auto-extracts and validates BDS/EN standards referenced in tender documentation; caches results with TTL
- **Rich text editor** – In-browser editing of all generated sections via `RichTextEditor` with toolbar (`EditorToolbar`)
- **Street View images** – Google Maps Street View integration for location imagery in exported documents
- **Offer management** – Upload complete offer documents, extract sections, embed with vector embeddings for similarity search
- **Admin panel** – Manage SMR templates, team position templates, and offers
- **Tender management** – Create, list, edit, and delete tenders
- **DOCX export** – Download DOCX with introduction, KSS texts, team organization, and communication section

## Project structure

```
├── app/
│   ├── api/
│   │   ├── admin/
│   │   │   ├── offer-images/[filename]/route.ts
│   │   │   ├── offers/route.ts
│   │   │   ├── offers/[id]/sections/route.ts
│   │   │   ├── team-templates/route.ts
│   │   │   ├── team-templates/download/route.ts
│   │   │   ├── templates/route.ts
│   │   │   └── templates/download/route.ts
│   │   ├── generate-docx/route.ts
│   │   ├── generate-introduction/route.ts
│   │   ├── generate-kss-smr/route.ts
│   │   ├── generate-team-organization/route.ts
│   │   ├── generate-communication/route.ts  
│   │   ├── validate-standards/route.ts      
│   │   ├── clear-standards-cache/route.ts   
│   │   ├── parse-files/route.ts
│   │   └── tenders/route.ts & [id]/route.ts
│   ├── admin/templates/page.tsx
│   ├── tender/[id]/page.tsx
│   ├── components/
│   │   ├── HomePage.tsx
│   │   ├── TenderListPage.tsx
│   │   ├── TenderSource.tsx
│   │   ├── Introduction.tsx
│   │   ├── KssSmrSection.tsx
│   │   ├── TeamOrganization.tsx
│   │   ├── Communication.tsx           
│   │   ├── RichTextEditor.tsx          
│   │   ├── EditorToolbar.tsx           
│   │   └── GenerateDocxButton.tsx
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── lib/
│   ├── fileParser.ts
│   ├── langchainClient.ts
│   ├── introductionGenerator.ts
│   ├── communicationGenerator.ts       
│   ├── verbatimSections.ts
│   ├── kssParser.ts
│   ├── smrTemplateParser.ts
│   ├── smrMatcher.ts
│   ├── kssSmrGenerator.ts
│   ├── teamOrganizationGenerator.ts
│   ├── teamPositionExtractor.ts
│   ├── teamTemplateParser.ts
│   ├── teamTemplateStorage.ts
│   ├── standardsExtractor.ts           
│   ├── standardsValidator.ts           
│   ├── standardsCache.ts               
│   ├── docxGenerator.ts
│   ├── htmlToDocxBody.ts
│   ├── satelliteImage.ts
│   ├── filenameEncoding.ts
│   ├── offerParser.ts
│   ├── offerEmbeddings.ts
│   ├── offerStorage.ts
│   ├── templateStorage.ts
│   ├── tenderStorage.ts
│   └── prompts/
│       ├── introductionPrompt.ts
│       ├── communicationPrompt.ts      
│       ├── smrMatcherPrompt.ts
│       └── teamPrompt.ts
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

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Optional
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
NEXT_PUBLIC_TEMPLATES_PIN=your_pin_here
```

**Required:**

- `OPENAI_API_KEY` – OpenAI API key for LangChain/LLM calls (server-side only, never exposed to client)
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` – Supabase project for tenders, templates, and offers storage

**Optional:**

- `GOOGLE_MAPS_API_KEY` – Google Maps Street View images in DOCX export
- `NEXT_PUBLIC_TEMPLATES_PIN` – PIN for admin panel access

### 3. Run locally

**Development:**

```bash
npm run dev
```

Starts Next.js dev server at http://localhost:3000.

**Production build:**

```bash
npm run build
npm run start
```

## Usage flow

1. **Create a tender** from the home page

2. **Upload files** – Upload PDF/DOCX tender documentation (multiple allowed)

3. **Generate sections** – Use AI to generate introduction, KSS/SMR texts, team organization, and communication section

4. **Edit** – Each section can be edited in-browser via the rich text editor before export

5. **Export** – Click **Generate DOCX** to download the final document

## Security

- File size limit: 100MB per file
- Only PDF and DOCX allowed
- OpenAI API key used only on the server
