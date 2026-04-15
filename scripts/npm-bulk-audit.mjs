#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const DEFAULT_ENDPOINT = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const DEFAULT_LOCKFILE = "pnpm-lock.yaml";
const DEFAULT_AUDIT_LEVEL = "high";
const CHUNK_SIZE = 300;

const SEVERITY_RANK = new Map([
  ["info", 0],
  ["low", 1],
  ["moderate", 2],
  ["high", 3],
  ["critical", 4],
]);

function parseArgs(argv) {
  const options = {
    auditLevel: DEFAULT_AUDIT_LEVEL,
    endpoint: process.env.NPM_BULK_AUDIT_ENDPOINT ?? DEFAULT_ENDPOINT,
    lockfile: DEFAULT_LOCKFILE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--audit-level") {
      options.auditLevel = argv[index + 1] ?? options.auditLevel;
      index += 1;
    } else if (arg.startsWith("--audit-level=")) {
      options.auditLevel = arg.slice("--audit-level=".length);
    } else if (arg === "--endpoint") {
      options.endpoint = argv[index + 1] ?? options.endpoint;
      index += 1;
    } else if (arg.startsWith("--endpoint=")) {
      options.endpoint = arg.slice("--endpoint=".length);
    } else if (arg === "--lockfile") {
      options.lockfile = argv[index + 1] ?? options.lockfile;
      index += 1;
    } else if (arg.startsWith("--lockfile=")) {
      options.lockfile = arg.slice("--lockfile=".length);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!SEVERITY_RANK.has(options.auditLevel)) {
    throw new Error(
      `Invalid --audit-level "${options.auditLevel}". Expected one of: ${[...SEVERITY_RANK.keys()].join(", ")}`,
    );
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/npm-bulk-audit.mjs [options]

Options:
  --audit-level <level>  Minimum severity that fails the audit. Defaults to high.
  --endpoint <url>       npm bulk advisory endpoint. Defaults to the public npm registry.
  --lockfile <path>      pnpm lockfile path. Defaults to pnpm-lock.yaml.
`);
}

function parsePackageKey(rawKey) {
  let spec = rawKey;
  if (spec.startsWith("/")) {
    spec = spec.slice(1);
  }

  const peerSuffixIndex = spec.indexOf("(");
  if (peerSuffixIndex !== -1) {
    spec = spec.slice(0, peerSuffixIndex);
  }

  const versionSeparator = spec.startsWith("@")
    ? spec.indexOf("@", spec.indexOf("/") + 1)
    : spec.lastIndexOf("@");
  if (versionSeparator === -1) {
    return null;
  }

  const name = spec.slice(0, versionSeparator);
  const version = spec.slice(versionSeparator + 1);
  if (!name || !version || version.startsWith("link:") || version.startsWith("file:")) {
    return null;
  }

  return { name, version };
}

function extractLockedPackages(lockfileText) {
  const packages = new Map();
  let inPackagesSection = false;

  for (const line of lockfileText.split(/\r?\n/)) {
    if (line === "packages:") {
      inPackagesSection = true;
      continue;
    }

    if (inPackagesSection && /^\S/.test(line)) {
      break;
    }

    if (!inPackagesSection) {
      continue;
    }

    const match = line.match(/^  ['"]?(\/[^'":]+(?:\([^'"]+\))?)['"]?:\s*$/);
    if (!match) {
      continue;
    }

    const parsed = parsePackageKey(match[1]);
    if (!parsed) {
      continue;
    }

    const versions = packages.get(parsed.name) ?? new Set();
    versions.add(parsed.version);
    packages.set(parsed.name, versions);
  }

  return packages;
}

function chunkEntries(entries, size) {
  const chunks = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(entries.slice(index, index + size));
  }
  return chunks;
}

async function fetchBulkAdvisories(endpoint, entries) {
  const advisories = {};

  for (const chunk of chunkEntries(entries, CHUNK_SIZE)) {
    const payload = Object.fromEntries(
      chunk.map(([name, versions]) => [name, [...versions].sort()]),
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "agentctl-npm-bulk-audit",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`npm bulk advisory endpoint responded with ${response.status}: ${body}`);
    }

    Object.assign(advisories, await response.json());
  }

  return advisories;
}

function flattenAdvisories(advisories, packages) {
  return Object.entries(advisories)
    .flatMap(([packageName, packageAdvisories]) =>
      packageAdvisories.map((advisory) => {
        const versions = packages.get(packageName) ?? [];
        return {
          packageName,
          versions: [...versions].sort(),
          id: advisory.id,
          severity: advisory.severity,
          title: advisory.title,
          url: advisory.url,
          vulnerableVersions: advisory.vulnerable_versions,
        };
      }),
    )
    .sort((left, right) => {
      const severityDelta =
        (SEVERITY_RANK.get(right.severity) ?? -1) -
        (SEVERITY_RANK.get(left.severity) ?? -1);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return `${left.packageName}:${left.id}`.localeCompare(`${right.packageName}:${right.id}`);
    });
}

function printAdvisories(advisories, thresholdRank) {
  const failing = advisories.filter(
    (advisory) => (SEVERITY_RANK.get(advisory.severity) ?? -1) >= thresholdRank,
  );
  const belowThreshold = advisories.length - failing.length;

  for (const advisory of failing) {
    console.error(
      [
        `${advisory.severity.toUpperCase()}: ${advisory.packageName}@${advisory.versions.join(", ")}`,
        advisory.title,
        `vulnerable: ${advisory.vulnerableVersions}`,
        advisory.url,
      ].join(" | "),
    );
  }

  if (belowThreshold > 0) {
    console.log(`${belowThreshold} advisory/advisories were below the configured audit level.`);
  }

  return failing.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const thresholdRank = SEVERITY_RANK.get(options.auditLevel);
  const lockfileText = await readFile(options.lockfile, "utf8");
  const packages = extractLockedPackages(lockfileText);
  const entries = [...packages.entries()].sort(([left], [right]) => left.localeCompare(right));
  const versionCount = entries.reduce((count, [, versions]) => count + versions.size, 0);

  if (entries.length === 0) {
    throw new Error(`No locked npm packages found in ${options.lockfile}`);
  }

  const advisories = flattenAdvisories(await fetchBulkAdvisories(options.endpoint, entries), packages);
  const failingCount = printAdvisories(advisories, thresholdRank);

  if (failingCount > 0) {
    console.error(`Dependency audit failed: ${failingCount} advisory/advisories at ${options.auditLevel} or above.`);
    process.exit(1);
  }

  console.log(
    `Dependency audit passed: no advisories at ${options.auditLevel} or above across ${entries.length} packages/${versionCount} locked versions.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
