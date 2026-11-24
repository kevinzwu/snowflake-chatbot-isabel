import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployments
  output: "standalone",

  // Externalize packages from SSR bundling to avoid Worker resolution issues.
  // Note: pdfjs-dist is NOT listed here — it's a transitive dep of pdf-parse
  // and must be resolved through pdf-parse's node_modules (pnpm symlinks).
  serverExternalPackages: ["jspdf", "pdf-parse"],

  // Allow larger request body for file uploads (10 MB)
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
      allowedOrigins: ["localhost:3000"],
    },
  },

  // Force-include pdf-parse and pdfjs-dist files in standalone output.
  // The pdfjs-dist worker file is loaded dynamically by path at runtime,
  // so the file tracer may not detect it automatically.
  outputFileTracingIncludes: {
    "/api/v1/extract-text": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/pdfjs-dist/**/*",
    ],
  },

  // Enable source maps in development for better debugging
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.devtool = isServer ? "source-map" : "eval-source-map";
    }
    return config;
  },

  // Add empty turbopack config to silence Next.js 16 warning
  turbopack: {},

  // Security headers for all responses
  async headers() {
    return [
      {
        // Apply to all routes
        source: "/:path*",
        headers: [
          {
            // Strict Transport Security - enforce HTTPS for 1 year
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            // Prevent clickjacking by disallowing iframe embedding
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            // Prevent MIME type sniffing
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            // Control referrer information sent with requests
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // Disable browser features we don't need
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            // Content Security Policy - restrict resource loading
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires unsafe-inline/eval
              "style-src 'self' 'unsafe-inline'", // Next.js requires unsafe-inline for styled-jsx
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.snowflakecomputing.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
