const dev = !!process.env.DEV || process.argv.includes("--dev");

require("esbuild")
  .build({
    minify: !dev,
    bundle: true,
    platform: "node",
    sourcemap: dev,
    entryPoints: ["src/index.ts"],
    outdir: "out",
  })
  .catch(() => process.exit(1));
