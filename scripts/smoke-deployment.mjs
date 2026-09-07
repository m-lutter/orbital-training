import { readFile } from "node:fs/promises";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return process.argv
    .find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectedVersion() {
  const source = await readFile(
    new URL("../src/lib/app-meta.ts", import.meta.url),
    "utf8",
  );
  const version = source.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
  assert(version !== undefined, "APP_VERSION could not be read.");
  return version;
}

async function request(url, options = {}) {
  return fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    ...options,
  });
}

const suppliedUrl = argumentValue("--url") ?? process.env.SMOKE_BASE_URL ?? "";
let baseUrl;
try {
  baseUrl = new URL(suppliedUrl);
} catch {
  throw new Error(
    "Provide an absolute deployment URL with --url or SMOKE_BASE_URL.",
  );
}
assert(
  ["http:", "https:"].includes(baseUrl.protocol),
  "The smoke-test URL must use HTTP or HTTPS.",
);
baseUrl.pathname = "/";
baseUrl.search = "";
baseUrl.hash = "";

const version = await expectedVersion();
const health = await request(new URL("api/health", baseUrl));
assert(health.status === 200, `/api/health returned ${health.status}.`);
const healthPayload = await health.json();
assert(healthPayload.status === "ok", "Health status was not ok.");
assert(
  healthPayload.version === version,
  `Expected deployed version ${version}, received ${String(healthPayload.version)}.`,
);
assert(
  health.headers.get("cache-control")?.includes("no-store"),
  "Health responses must not be cached.",
);

const login = await request(new URL("login", baseUrl));
assert(login.status === 200, `/login returned ${login.status}.`);
const csp = login.headers.get("content-security-policy") ?? "";
assert(csp.includes("default-src 'self'"), "CSP default-src is missing.");
assert(csp.includes("frame-ancestors 'none'"), "CSP framing rule is missing.");
assert(
  login.headers.get("x-content-type-options") === "nosniff",
  "X-Content-Type-Options is missing.",
);
assert(
  login.headers.get("x-frame-options") === "DENY",
  "X-Frame-Options is missing.",
);
if (baseUrl.protocol === "https:")
  assert(
    login.headers.get("strict-transport-security")?.includes("max-age="),
    "HSTS is missing from the HTTPS deployment.",
  );

const dashboard = await request(new URL("dashboard", baseUrl));
assert(
  [302, 303, 307, 308].includes(dashboard.status),
  `Signed-out /dashboard returned ${dashboard.status} instead of redirecting.`,
);
const destination = dashboard.headers.get("location");
assert(destination !== null, "The dashboard redirect has no Location header.");
assert(
  new URL(destination, baseUrl).pathname === "/login",
  `Signed-out /dashboard redirected to ${destination}.`,
);

console.log(`Deployment smoke test passed for ${baseUrl.origin} (${version}).`);
