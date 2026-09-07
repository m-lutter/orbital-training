import { readdir, readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const checkBudgets = process.argv.includes("--check");
const jsonOnly = process.argv.includes("--json");
const clientRoot = path.join(root, ".svelte-kit", "output", "client");
const cloudflareRoot = path.join(root, ".svelte-kit", "cloudflare");
const staticRoot = path.join(root, "static");
const clientManifestPath = path.join(clientRoot, ".vite", "manifest.json");
const serverManifestPath = path.join(
  root,
  ".svelte-kit",
  "output",
  "server",
  "manifest.js",
);
const budgets = JSON.parse(
  await readFile(
    new URL("../config/performance-budgets.json", import.meta.url),
  ),
);

async function filesBelow(directory) {
  const results = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) results.push(absolute);
    }
  }
  await visit(directory);
  return results;
}

function relativeUnix(parent, child) {
  return path.relative(parent, child).split(path.sep).join("/");
}

async function fileSize(absolute) {
  return (await stat(absolute)).size;
}

async function gzipSize(absolute) {
  return gzipSync(await readFile(absolute)).byteLength;
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function manifestClosure(manifest, entryKey) {
  const keys = new Set();
  const visit = (key) => {
    if (keys.has(key)) return;
    const item = manifest[key];
    if (item === undefined) return;
    keys.add(key);
    for (const imported of item.imports ?? []) visit(imported);
  };
  visit(entryKey);
  return keys;
}

async function summarizeManifestEntries(
  manifest,
  entryKeys,
  excludedKeys = new Set(),
) {
  const files = new Set();
  const css = new Set();
  for (const entryKey of entryKeys) {
    for (const key of manifestClosure(manifest, entryKey)) {
      if (excludedKeys.has(key)) continue;
      const item = manifest[key];
      if (item?.file !== undefined) files.add(item.file);
      for (const cssFile of item?.css ?? []) css.add(cssFile);
    }
  }
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const file of [...files, ...css]) {
    const absolute = path.join(clientRoot, file);
    rawBytes += await fileSize(absolute);
    gzipBytes += await gzipSize(absolute);
  }
  return { rawBytes, gzipBytes, files: files.size, cssFiles: css.size };
}

try {
  const clientManifest = JSON.parse(await readFile(clientManifestPath, "utf8"));
  const serverManifestUrl = `${pathToFileURL(serverManifestPath).href}?t=${Date.now()}`;
  const { manifest: serverManifest } = await import(serverManifestUrl);

  const shellKeys = Object.keys(clientManifest).filter(
    (key) =>
      key.endsWith("/runtime/client/entry.js") ||
      key.endsWith("/generated/client-optimized/app.js") ||
      key.endsWith("/generated/client-optimized/nodes/0.js"),
  );
  const shellClosure = new Set(
    shellKeys.flatMap((key) => [...manifestClosure(clientManifest, key)]),
  );
  const shell = await summarizeManifestEntries(clientManifest, shellKeys);

  const routes = [];
  for (const route of serverManifest._.routes) {
    if (route.page === null) continue;
    const leaf = route.page.leaf;
    const nodeKey = `.svelte-kit/generated/client-optimized/nodes/${leaf}.js`;
    routes.push({
      route: route.id,
      ...(await summarizeManifestEntries(
        clientManifest,
        [nodeKey],
        shellClosure,
      )),
    });
  }

  const staticFiles = await filesBelow(staticRoot);
  const staticBytes = (
    await Promise.all(staticFiles.map((file) => fileSize(file)))
  ).reduce((sum, size) => sum + size, 0);
  const largestStaticFiles = (
    await Promise.all(
      staticFiles.map(async (file) => ({
        file: relativeUnix(staticRoot, file),
        bytes: await fileSize(file),
      })),
    )
  )
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 8);

  const clientFiles = new Set(
    (await filesBelow(clientRoot)).map((file) =>
      relativeUnix(clientRoot, file),
    ),
  );
  const cloudflareFiles = await filesBelow(cloudflareRoot);
  const staleCloudflareFiles = [];
  for (const file of cloudflareFiles) {
    const relative = relativeUnix(cloudflareRoot, file);
    if (relative.startsWith("_app/immutable/") && !clientFiles.has(relative)) {
      staleCloudflareFiles.push({
        file: relative,
        bytes: await fileSize(file),
      });
    }
  }
  staleCloudflareFiles.sort((left, right) => right.bytes - left.bytes);

  const warnings = [];
  const failures = [];
  if (shell.gzipBytes > budgets.client.shellGzipMaximumBytes) {
    failures.push(
      `Client shell is ${shell.gzipBytes} gzip bytes; maximum is ${budgets.client.shellGzipMaximumBytes}.`,
    );
  } else if (shell.gzipBytes > budgets.client.shellGzipWarningBytes) {
    warnings.push(`Client shell is ${shell.gzipBytes} gzip bytes.`);
  }
  for (const route of routes) {
    if (route.gzipBytes > budgets.client.routeIncrementalGzipMaximumBytes) {
      failures.push(
        `${route.route} is ${route.gzipBytes} gzip bytes; maximum is ${budgets.client.routeIncrementalGzipMaximumBytes}.`,
      );
    } else if (
      route.gzipBytes > budgets.client.routeIncrementalGzipWarningBytes
    ) {
      warnings.push(`${route.route} is ${route.gzipBytes} gzip bytes.`);
    }
  }
  if (staticBytes > budgets.assets.staticMaximumBytes) {
    failures.push(
      `Static assets total ${staticBytes} bytes; maximum is ${budgets.assets.staticMaximumBytes}.`,
    );
  } else if (staticBytes > budgets.assets.staticWarningBytes) {
    warnings.push(`Static assets total ${staticBytes} bytes.`);
  }
  if (
    staleCloudflareFiles.length >
    budgets.assets.staleCloudflareAssetWarningCount
  ) {
    warnings.push(
      `${staleCloudflareFiles.length} stale hashed assets remain in .svelte-kit/cloudflare.`,
    );
  }

  const report = {
    measuredAt: new Date().toISOString(),
    runtime: process.version,
    shell,
    routes,
    static: {
      files: staticFiles.length,
      bytes: staticBytes,
      largestFiles: largestStaticFiles,
    },
    cloudflare: {
      files: cloudflareFiles.length,
      staleHashedFiles: staleCloudflareFiles.length,
      staleHashedBytes: staleCloudflareFiles.reduce(
        (sum, item) => sum + item.bytes,
        0,
      ),
      largestStaleFiles: staleCloudflareFiles.slice(0, 8),
    },
    warnings,
    failures,
  };

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("\nClient build baseline\n");
    console.log(
      `Shared client shell: ${round(shell.rawBytes / 1024)} KiB raw / ${round(shell.gzipBytes / 1024)} KiB gzip`,
    );
    console.table(
      routes.map((route) => ({
        route: route.route,
        "raw KiB": round(route.rawBytes / 1024),
        "gzip KiB": round(route.gzipBytes / 1024),
        files: route.files,
        css: route.cssFiles,
      })),
    );
    console.log(
      `Static assets: ${staticFiles.length} files / ${round(staticBytes / 1024)} KiB`,
    );
    console.table(
      largestStaticFiles.map((item) => ({
        file: item.file,
        "size KiB": round(item.bytes / 1024),
      })),
    );
    for (const warning of warnings) console.warn(`WARNING: ${warning}`);
    for (const failure of failures) console.error(`ERROR: ${failure}`);
    console.log(
      "Run after a production build. --check fails deterministic hard limits only.",
    );
  }

  if (checkBudgets && failures.length > 0) process.exitCode = 1;
} catch (error) {
  if (error?.code === "ENOENT") {
    console.error(
      "No production build was found. Run `npm run build:app` before this script.",
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
}
