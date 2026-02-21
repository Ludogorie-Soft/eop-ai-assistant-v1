# AI Tender Technical Specification Generator – Implementation Plan (v2: Rules + Exemplars)

## Principles
- [ ] DOCX master template is source of truth (placeholders drive generation)
- [ ] Section-based generation with approval workflow
- [ ] Full traceability (refs + footnotes)
- [ ] Numeric consistency from KSS canonical data only
- [ ] AI Decision Log appended to document
- [ ] v2 approach: Rules + Exemplars learning
- [ ] Dev phase uses free LLM provider (no token cost)

---

# Phase 1 — MVP (Street templates: Main / Current Repair / Engineering)

## 1. Ingest & Storage
- [ ] CAIS page fetch (HTML)
- [ ] Attachment extraction
- [ ] Attachment download → storage
- [ ] Manual file upload UI
- [ ] File metadata + checksum
- [ ] Snapshot versioning

## 2. Parsing Pipeline
- [ ] PDF/DOCX text extraction
- [ ] Layout-aware parsing (headings + numbering)
- [ ] Page mapping per node
- [ ] Table extraction → JSON
- [ ] doc_nodes DB storage
- [ ] Embeddings for nodes

## 3. KSS (Quantity Bill) Processing
- [ ] Excel parser
- [ ] Canonical KSS schema (code, name, unit, qty)
- [ ] Decimal normalization
- [ ] Unit normalization
- [ ] Duplicate detection
- [ ] Totals validation
- [ ] KSS UI preview
- [ ] KSS confirm step
- [ ] KSS DB storage
- [ ] KSS embeddings

## 4. Template System
- [ ] Master DOCX placeholders inserted
- [ ] Template metadata schema
- [ ] Placeholder → section mapping
- [ ] DOCX renderer engine
- [ ] Footnote injection support
- [ ] Clean export mode

## 5. SMR Catalog
- [ ] Import SMR Excel
- [ ] SMR canonical schema
- [ ] SMR embeddings
- [ ] SMR template node mapping
- [ ] SMR retrieval API

## 6. AI Pipeline (Free LLM mode)
- [ ] LLM abstraction layer
- [ ] Free model provider integration
- [ ] Embedding provider abstraction
- [ ] Planner chain
- [ ] Generator: Intro
- [ ] Generator: Technology
- [ ] Generator: Team
- [ ] Generator: Communication
- [ ] Decision log generation
- [ ] Section JSON schema
- [ ] Citation extraction
- [ ] Ref anchoring

## 7. Rules Engine (v2)
- [ ] Role naming rules
- [ ] Numeric consistency rules
- [ ] Section structure rules
- [ ] Missing info rules
- [ ] Rule evaluation layer
- [ ] UI rule warnings
- [ ] Export rule report

## 8. Exemplars (v2)
- [ ] User edit capture
- [ ] Section similarity index
- [ ] Exemplar retrieval
- [ ] Generator exemplar conditioning
- [ ] Negative exemplars storage
- [ ] Exemplar UI viewer

## 9. Section Editor UI
- [ ] Section list panel
- [ ] Rich text editor
- [ ] Citation viewer
- [ ] Decision notes panel
- [ ] Rule warnings panel
- [ ] Approve button
- [ ] Section status badges
- [ ] Diff vs AI
- [ ] Diff vs last

## 10. Collaboration
- [ ] Section locking
- [ ] Lock expiration
- [ ] Multi-user roles
- [ ] Author / Reviewer / Approver
- [ ] Version history
- [ ] Change audit log

## 11. Export
- [ ] DOCX with footnotes
- [ ] Clean DOCX
- [ ] Decision log appendix
- [ ] Rule validation appendix
- [ ] Export storage
- [ ] Download endpoint

---

# Phase 2 — Quality & Validation

## Numeric Integrity
- [ ] Number extractor
- [ ] Unit parser
- [ ] KSS cross-check
- [ ] Mismatch detection
- [ ] Highlight in editor

## Ref Maintenance
- [ ] Stale ref detection
- [ ] Re-anchor refs
- [ ] Ref confidence score

## Rules Expansion
- [ ] Role presence checks
- [ ] Mandatory sections checks
- [ ] Structural compliance
- [ ] Procurement-specific rules

---

# Phase 3 — Learning System

## Silver (User Edits)
- [ ] Edit diff storage
- [ ] Approved version capture
- [ ] Exemplar weighting
- [ ] Similarity clustering

## Gold (Evaluation Protocols)
- [ ] Protocol upload
- [ ] Issue extraction
- [ ] Section mapping
- [ ] Rule suggestion
- [ ] Negative exemplar creation

## Analytics
- [ ] Frequent issues dashboard
- [ ] Weak sections heatmap
- [ ] Rule trigger stats

---

# Infrastructure

## Backend
- [ ] Next.js API routes
- [ ] Worker service
- [ ] Queue system
- [ ] Supabase DB
- [ ] Supabase Storage
- [ ] Auth & roles

## Vector Search
- [ ] pgvector setup
- [ ] HNSW index
- [ ] Similarity search API

## LLM Providers
- [ ] Free dev model
- [ ] OpenAI prod model
- [ ] Config switch
- [ ] Provider fallback

---

# Free LLM Strategy (Development)

- [ ] Integrate local LLM (Ollama)
- [ ] Default dev model config
- [ ] Low-quality tolerant prompts
- [ ] Deterministic settings
- [ ] Mock mode option
- [ ] Logging prompts/responses

---

# Testing

## Parsing
- [ ] PDF parsing tests
- [ ] DOCX parsing tests
- [ ] Excel KSS tests

## AI
- [ ] Planner outputs
- [ ] Generator outputs
- [ ] Rule detection

## Export
- [ ] DOCX structure
- [ ] Footnotes
- [ ] Clean mode

---

# Deployment

- [ ] AWS EC2 setup
- [ ] Storage buckets
- [ ] DB migrations
- [ ] Env configs
- [ ] CI/CD pipeline

---

# Definition of Done

- [ ] CAIS link → generated DOCX
- [ ] Numeric consistency validated
- [ ] Sections editable & approvable
- [ ] Decision log present
- [ ] Rules enforced
- [ ] Exemplars learned
