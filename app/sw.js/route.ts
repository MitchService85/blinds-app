/**
 * The service worker, served with a per-deploy identity.
 *
 * It used to be a static file in public/. A browser only treats a worker as
 * updated when the SCRIPT BYTES change, and those bytes never did — so
 * `updatefound` never fired, the "A new version is ready" banner was
 * unreachable code, and a phone could sit on a cached build with no way to
 * be told otherwise (found 2026-09-04, after a keyboard fix shipped and the
 * crew's phone kept showing the old build).
 *
 * Stamping a build id in at request time is deliberate: baking it into the
 * client bundle instead (next.config `env` + a ?v= query) looks equivalent
 * but is not — the bundler's persistent cache reuses the compiled module
 * when only an env value changed, so two different deploys emitted the same
 * stamp. Verified: two consecutive builds produced byte-identical output.
 * Serving it from here bypasses the bundler entirely.
 */

/** Never prerendered or cached: the stamp must be read per request. */
export const dynamic = "force-dynamic";

/**
 * Stable for a whole deploy, different between deploys. On Vercel the
 * deployment id is exactly that. The process-start fallback only applies to
 * self-hosting; it is stable per process, so a multi-instance host without
 * these variables could disagree between instances and re-prompt — set
 * VERCEL_DEPLOYMENT_ID (or any build id) there.
 */
const FALLBACK_BUILD = String(Date.now());

function buildId(): string {
  return (
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    FALLBACK_BUILD
  );
}

/**
 * Minimal app-shell worker.
 *
 * - Caches a small shell on install, under a name carrying this build, so
 *   activating a new version drops the previous build's assets instead of
 *   serving them back offline.
 * - Never auto-activates over a running version: it waits for the page
 *   (lib/sw.ts) to post SKIP_WAITING when the crew accepts the banner.
 * - Network-first with cache fallback, so the app still opens on a site with
 *   no signal.
 */
function source(build: string): string {
  return `// Generated per deploy by app/sw.js/route.ts — do not cache.
const BUILD = ${JSON.stringify(build)};
const CACHE_NAME = "measure-shell-" + BUILD;
const SHELL_ASSETS = ["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch((err) => {
        // One missing shell asset must not block installation.
        console.error("[sw] shell precache failed", err);
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (!request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
  );
});
`;
}

export async function GET(): Promise<Response> {
  return new Response(source(buildId()), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // The browser must always see the current bytes; a cached copy would
      // put us right back to a worker that can never look updated.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
