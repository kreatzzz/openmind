import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const tauriConfig = JSON.parse(
  await readFile("src-tauri/tauri.conf.json", "utf8"),
);
const cargoManifest = await readFile("src-tauri/Cargo.toml", "utf8");
const cargoPackage = cargoManifest.match(
  /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
);

if (!cargoPackage) {
  throw new Error(
    "Could not read the package version from src-tauri/Cargo.toml",
  );
}

const versions = new Map([
  ["package.json", packageJson.version],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
  ["src-tauri/Cargo.toml", cargoPackage[1]],
]);
const uniqueVersions = new Set(versions.values());

if (uniqueVersions.size !== 1) {
  const details = [...versions]
    .map(([file, version]) => `${file}: ${version}`)
    .join("\n");
  throw new Error(`Desktop versions do not match:\n${details}`);
}

const [version] = uniqueVersions;
const releaseTag = process.env.RELEASE_TAG;

if (releaseTag && releaseTag !== `v${version}`) {
  throw new Error(
    `Release tag ${releaseTag} does not match the application version v${version}`,
  );
}

console.log(
  `Verified desktop version ${version}${releaseTag ? ` for ${releaseTag}` : ""}.`,
);
