import { access, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const targets = [
  path.join(root, ".svelte-kit", "output"),
  path.join(root, ".svelte-kit", "cloudflare"),
];

const obsoleteStaticAssets = [path.join(root, "static", "app-icon.png")];

for (const asset of obsoleteStaticAssets) {
  try {
    await access(asset, constants.F_OK);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      continue;
    }
    throw error;
  }

  throw new Error(
    `Obsolete static asset found: ${path.relative(root, asset)}. ` +
      "Delete it before building. Archive extraction does not remove files that a patch deleted, and retaining this legacy icon adds about 1.4 MiB to every deployment.",
  );
}

for (const target of targets) {
  const relative = path.relative(root, target);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !relative.startsWith(`.svelte-kit${path.sep}`)
  ) {
    throw new Error(`Refusing to clean unexpected build path: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}
