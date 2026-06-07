import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
