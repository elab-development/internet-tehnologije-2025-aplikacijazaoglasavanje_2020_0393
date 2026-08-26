import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Transformers.js loads a native onnxruntime binary. Bundling it is not merely
  // wasteful — the build fails on the .node file, in a way that does not point back here.
  serverExternalPackages: ["@huggingface/transformers"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
