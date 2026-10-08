// Which build this is, for the version stamp in Settings.
//
// Server-side only, and read when the page is RENDERED, never inlined into
// the client bundle. That distinction is the whole point: an earlier stamp
// baked in through next.config `env` came out byte-identical across two
// different deploys, because the bundler's persistent cache reused the
// compiled module when only an env value changed (see app/sw.js/route.ts).
// A render-time read of process.env cannot be cached that way — and a
// version stamp that can lie is worse than none.

/** Short git commit of this deploy, or "dev" off Vercel. */
export function buildSha(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev";
}
