import { readFile, writeFile } from "node:fs/promises";

const manifestPath = new URL("../src/shared/version-manifest.ts", import.meta.url);

async function fetchLatestVersion() {
  const response = await fetch("https://api.github.com/repos/cli/cli/releases/latest", {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "command-foundry-gh-cli-updater"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch latest GitHub CLI release: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return String(payload.tag_name ?? "").replace(/^v/, "");
}

function updateManifest(source, version) {
  const replacements = [
    [/recommendedGhVersion: "[^"]+"/, `recommendedGhVersion: "${version}"`],
    [
      /copilotCompatibility: "[^"]+"/,
      `copilotCompatibility: "Validated against GitHub CLI ${version} with support for 2.88.1 and newer 2.x releases."`
    ],
    [/download\/v[0-9.]+\//g, `download/v${version}/`],
    [/gh_[0-9.]+_/g, `gh_${version}_`]
  ];

  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), source);
}

function writeOutputs(outputs) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const body = Object.entries(outputs)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n");

  return writeFile(outputPath, `${body}\n`, { flag: "a" });
}

const latestVersion = await fetchLatestVersion();
const current = await readFile(manifestPath, "utf8");
const next = updateManifest(current, latestVersion);
const changed = next !== current;

if (changed) {
  await writeFile(manifestPath, next, "utf8");
}

await writeOutputs({
  latest_version: latestVersion,
  changed
});

console.log(changed ? `Updated version manifest to GitHub CLI ${latestVersion}.` : `Version manifest already targets GitHub CLI ${latestVersion}.`);
