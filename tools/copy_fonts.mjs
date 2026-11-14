// Copies the self-hosted fonts from the @fontsource packages into site/fonts.
//   npm run fonts      (after npm install; commit site/fonts)
// Fails with the list of available files if a package names its files differently.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const FONTS = [
  ["ibm-plex-sans", [400, 500, 600]],
  ["ibm-plex-sans-condensed", [500, 600, 700]],
  ["ibm-plex-mono", [400, 500]],
];

const out = "site/fonts";
mkdirSync(out, { recursive: true });
let missing = 0;
for (const [slug, weights] of FONTS) {
  const dir = join("node_modules", "@fontsource", slug, "files");
  if (!existsSync(dir)) { console.error(`Missing package @fontsource/${slug}: run npm install`); missing++; continue; }
  for (const w of weights) {
    const name = `${slug}-latin-${w}-normal.woff2`;
    if (!existsSync(join(dir, name))) {
      console.error(`Not found: ${name}. Available: ${readdirSync(dir).filter((f) => f.includes("latin-")).slice(0, 8).join(", ")} …`);
      missing++;
      continue;
    }
    copyFileSync(join(dir, name), join(out, name));
    console.log(`copied ${name}`);
  }
}
process.exitCode = missing ? 1 : 0;
