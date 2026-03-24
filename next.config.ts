import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Proxy PostHog event ingestion through our own domain
        // This bypasses ad blockers that would block posthog.com directly
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  // Required for PostHog ingestion proxy
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
