import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent MIME sniffing of JSON, images and downloads.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking protection (also expressed through frame-ancestors below).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The QR scanner needs the camera on this origin; other powerful features
  // are not used by the application.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
];

// HSTS is only advertised over HTTPS; local development uses plain HTTP.
if (process.env.NODE_ENV === "production") {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000",
  });
}

const nextConfig: NextConfig = {
  // tesseract.js spawns a worker and loads WASM from node_modules, so it must
  // stay a runtime dependency instead of being bundled into the server graph.
  serverExternalPackages: [
    "tesseract.js",
    "tesseract.js-core",
    "@tesseract.js-data/eng",
    // PDFKit loads its standard font metrics and streams from Node at runtime.
    "pdfkit",
  ],
  // The database CA is referenced at runtime from DATABASE_URL/DIRECT_URL.
  // Include it in the server trace so serverless bundles can verify TLS.
  outputFileTracingIncludes: {
    "/*": ["./certs/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
