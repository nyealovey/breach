import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

import './src/lib/env/client.ts';
import './src/lib/env/server.ts';

import { redirects } from './redirects.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * CSPs that we're not adding (as it can change from project to project):
 * frame-src, connect-src, script-src, child-src, style-src, worker-src, font-src, media-src, and img-src
 */
const ContentSecurityPolicy = `
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'self';
  manifest-src 'self';
  report-to default;
`;

// For more information, check https://nextjs.org/docs/app/api-reference/config/next-config-js/headers
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'no-referrer-when-downgrade',
  },
  {
    key: 'Permissions-Policy',
    value: `accelerometer=(), camera=(), gyroscope=(), microphone=(), usb=()`,
  },
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy.replace(/\n/g, ''),
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    // Prevent Turbopack from inferring an incorrect repo root when multiple lockfiles exist outside this worktree.
    root: __dirname,
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return redirects;
  },
  // @bokuweb/zstd-wasm reads zstd.wasm via fs + __dirname. When bundled by Turbopack, __dirname becomes a
  // virtual /ROOT path and fs reads can fail with ENOENT. Keep it external so Node can resolve real paths.
  serverExternalPackages: ['@bokuweb/zstd-wasm'],
  // Ensure zstd.wasm is included in output file tracing for deployments that prune files (standalone/serverless).
  outputFileTracingIncludes: {
    '/api/v1/source-records/**': ['node_modules/@bokuweb/zstd-wasm/dist/common/zstd.wasm'],
  },
  experimental: {
    // Enable caching for next build. FileSystem caching is enabled by default for development
    turbopackFileSystemCacheForBuild: true,
  },
  reactStrictMode: true,
  reactCompiler: true,
};

export default nextConfig;
