import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "release-assets");
const outputName = "SHA256SUMS.txt";

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(absolute);
      if (entry.isFile() && entry.name !== outputName) return [absolute];
      return [];
    }),
  );
  return files.flat();
}

const files = (await listFiles(root)).sort((left, right) =>
  left.localeCompare(right, "en"),
);

if (files.length === 0) {
  throw new Error(`No release assets found under ${root}`);
}

const lines = await Promise.all(
  files.map(async (file) => {
    const digest = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    const relative = path.relative(root, file).split(path.sep).join("/");
    return `${digest}  ${relative}`;
  }),
);

const output = path.join(root, outputName);
await writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${lines.length} SHA-256 checksums to ${output}.`);
