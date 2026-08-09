import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // public/cesium is copied out of node_modules by scripts/copy-cesium.mjs and
  // is not ours to lint.
  { ignores: [".next/**", "next-env.d.ts", "public/cesium/**"] },
];

export default config;
