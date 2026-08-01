import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // There is a stray package-lock.json in the home directory, so Turbopack's
  // root inference walks up and picks that instead of this project. Pin it.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },

  // lib/topics.ts reads topics.json from disk at request time via node:fs.
  // Keeping the SDK external stops the bundler trying to inline server deps.
  serverExternalPackages: ['@anthropic-ai/sdk'],
};

export default nextConfig;
