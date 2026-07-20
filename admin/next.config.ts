import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // This repo also has a root-level package-lock.json (the Expo app) — pin the
  // workspace root to this directory so Next.js doesn't have to guess.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
