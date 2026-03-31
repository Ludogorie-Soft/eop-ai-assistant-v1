# ── Stage 1: Install all deps ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package*.json ./
RUN npm install

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_TEMPLATES_PIN
ENV NEXT_PUBLIC_TEMPLATES_PIN=$NEXT_PUBLIC_TEMPLATES_PIN
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app

# Install Chromium + system deps required by Puppeteer and Tesseract.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    # Tesseract system lib (tesseract.js ships its own WASM engine but some
    # versions fall back to the system binary)
    tesseract-ocr \
    tesseract-ocr-bul \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Tell Puppeteer to use the system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Non-root user for security
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static   ./.next/static

# These packages are not picked up by the Next.js standalone file tracer
# (dynamic requires, optional deps) — copy them explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@napi-rs      ./node_modules/@napi-rs
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pdfjs-dist    ./node_modules/pdfjs-dist
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pdf-to-img    ./node_modules/pdf-to-img
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/tesseract.js  ./node_modules/tesseract.js
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pdf-parse     ./node_modules/pdf-parse

USER nextjs

# Cloud Run injects PORT; Next.js standalone server respects it
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
