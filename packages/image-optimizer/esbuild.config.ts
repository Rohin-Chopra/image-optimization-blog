import { build } from "esbuild";

build({
  entryPoints: ["./src/handler.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  outfile: ".esbuild/index.js",
  external: ["sharp"],
  loader: {
    ".node": "file",
  },
});
