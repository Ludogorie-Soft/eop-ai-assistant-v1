import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pdf-parse', 'pdf-to-img', 'tesseract.js', '@napi-rs/canvas'],
};

export default nextConfig;
