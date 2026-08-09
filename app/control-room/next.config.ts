import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Both are source-only workspace packages, so Next has to compile them.
  transpilePackages: ["@harvest/simulation", "@harvest/shared"],

  // Cesium ships large prebuilt bundles it loads by URL at runtime rather than
  // through the bundler. Tracing them would slow every build down for no gain,
  // since copy-cesium.mjs already places them in public/.
  outputFileTracingExcludes: {
    "*": ["./public/cesium/**"],
  },

  webpack(config) {
    // Cesium's ESM build references `import.meta.url` inside code paths that
    // Webpack tries to statically resolve. Leaving this on produces a wall of
    // critical-dependency warnings that bury real ones.
    config.module = config.module ?? {};
    config.module.unknownContextCritical = false;
    return config;
  },
};

export default nextConfig;
