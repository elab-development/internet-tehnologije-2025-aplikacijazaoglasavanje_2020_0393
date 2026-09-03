import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Transformers.js loads a native onnxruntime binary. Bundling it is not merely
  // wasteful — the build fails on the .node file, in a way that does not point back here.
  serverExternalPackages: ["@huggingface/transformers", "sharp"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // A year, with subdomains: anything shorter is advisory rather than a policy.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          // Send the full URL only same-origin. A listing URL carries an id, and the
          // referrer is the quietest way for it to reach a third party.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // frame-ancestors only. A full CSP needs a nonce strategy for Next's inline
          // scripts, which is its own piece of work (spec section 15); this is the part
          // that needs no strategy and stops the app being framed for clickjacking.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
