import type { NextConfig } from "next";

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
};

export default nextConfig;
