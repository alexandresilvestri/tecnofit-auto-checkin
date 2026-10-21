import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const banner =
  'import { createRequire } from "module"; const require = createRequire(import.meta.url);';

for (const entry of readdirSync("apps/functions", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const n = entry.name;
  await build({
    entryPoints: [`apps/functions/${n}/index.ts`],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    outfile: `dist/functions/${n}/index.mjs`,
    banner: { js: banner },
  });
  execFileSync(
    "zip",
    ["-X", "-j", `dist/functions/${n}.zip`, `dist/functions/${n}/index.mjs`],
    { stdio: "inherit" },
  );
}
