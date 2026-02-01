/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@vibe-edit/core", "@vibe-edit/ui"],
  experimental: {
    optimizePackageImports: ["@radix-ui/react-icons"],
  },
};

module.exports = nextConfig;
