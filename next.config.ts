import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', 'pdf-to-img', 'tesseract.js'],
};

export default nextConfig;
