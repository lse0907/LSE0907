import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const blockedAssets = [
  "rion-symbol.svg",
  "rion-symbol-white.svg",
];

function filesIn(directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(relative) : [relative];
  });
}

for (const asset of blockedAssets) {
  if (fs.existsSync(path.join(root, "public", asset))) {
    throw new Error(`Blocked legacy CI asset remains in public/${asset}`);
  }
}

for (const file of filesIn("src")) {
  if (!/\.(?:[cm]?[jt]sx?|css|scss)$/.test(file)) continue;
  const content = fs.readFileSync(path.join(root, file), "utf8");
  for (const asset of blockedAssets) {
    if (content.includes(asset)) throw new Error(`Blocked legacy CI reference in ${file}: ${asset}`);
  }
}

console.log("RION brand CI guard passed.");
