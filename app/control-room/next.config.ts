import { resolve } from "node:path";

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

  webpack(config, { isServer, webpack }) {
    // Cesium's ESM build references `import.meta.url` inside code paths that
    // Webpack tries to statically resolve. Leaving this on produces a wall of
    // critical-dependency warnings that bury real ones.
    config.module = config.module ?? {};
    config.module.unknownContextCritical = false;

    // @harvest/simulation is compiled with NodeNext, which requires its
    // relative imports to carry a '.js' extension even though the files on
    // disk are '.ts'. tsc and Vitest both understand that convention; Webpack
    // does not, and fails with "Can't resolve './core/queue.js'".
    //
    // extensionAlias teaches it the same mapping. The alternative — dropping
    // the extensions in the simulation package — would break that package's
    // own NodeNext build, so the fix belongs here, at the consumer that has
    // the unusual resolver.
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };

    // Recorded weather (#90) loads its committed dataset from disk, so
    // `simulation/src/world/weather-reference.ts` imports node:fs, node:path
    // and node:url. That file is pure data-shaping apart from the loader, and
    // `world/weather.ts` imports its evidence-type constants as values — which
    // is how the weather overlay (#39), a browser module, ends up with Node
    // built-ins in its graph and the client build fails with
    // "UnhandledSchemeError: Reading from node:fs is not handled by plugins".
    //
    // Webpack compiles every module the `@harvest/simulation` barrel reaches,
    // used or not, so the loader is built even though the control room never
    // calls it: it replays runs saved by the API and never calls `runScenario`
    // in the browser. Stubbing the three built-ins out of the *client* bundle
    // only is therefore accurate rather than a paper-over — the code path does
    // not exist here. The server bundle resolves them natively and keeps the
    // loader working, so a run created through the API still reads the
    // recorded dataset exactly as before.
    //
    // `resolve.fallback` cannot do this: webpack handles the `node:` scheme
    // before resolution, so a fallback entry is never consulted and the build
    // still fails. Rewriting the request to a stub module is the hook that runs
    // early enough.
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:(fs|path|url)$/, (resource: { request: string }) => {
          resource.request = resolve(import.meta.dirname, "src/lib/node-builtin-stub.ts");
        }),
      );
    }

    // Cesium's sources contain octal escape sequences inside string literals
    // (its GLSL shaders, among others). The SWC minifier rewrites some of those
    // strings as template literals, where octal escapes are a syntax error. The
    // result is a chunk the browser refuses to parse:
    //
    //   SyntaxError: Octal escape sequences are not allowed in template strings
    //   ChunkLoadError: Loading chunk 259 failed
    //
    // which surfaces as the globe never loading — the dynamic import simply
    // never resolves, so the loading state sits there forever. It only bites
    // production, because development builds are not minified, which makes it
    // exactly the sort of bug that reaches a demo unnoticed.
    //
    // Minification is therefore off for this app. It costs bundle size on a
    // page that already ships Cesium, and it is the smaller evil next to a
    // globe that does not appear. The tidier long-term fix is to stop bundling
    // Cesium altogether and load it from the copied /public/cesium build as an
    // external script, which sidesteps the minifier entirely.
    if (!config.optimization) config.optimization = {};
    config.optimization.minimize = false;

    return config;
  },
};

export default nextConfig;
