import type { NextConfig } from "next";

const maxUploadSize = (process.env.MAX_UPLOAD_SIZE || "100mb") as
  | `${number}${"kb" | "mb" | "gb"}`
  | number;

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "@napi-rs/canvas", "pdfjs-dist"],
  experimental: {
    proxyClientMaxBodySize: maxUploadSize,
  },
};

export default nextConfig;
