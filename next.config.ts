import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['puppeteer', 'pdf-parse'],
};

export default nextConfig;
