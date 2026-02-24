import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['puppeteer', 'pdf-parse', 'pdf-to-img', 'tesseract.js'],
};

export default nextConfig;
