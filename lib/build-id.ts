// Which build this is, for the version stamp in Settings.
//
// Server-side only, and read when the page is RENDERED, never inlined into
// the client bundle. That distinction is the whole point: an earlier stamp
// baked in through next.config `env` came out byte-identical across two
// different deploys, because the bundler's persistent cache reused the
// compiled module when only an env value changed (see app/sw.js/route.ts).
// A render-time read of process.env cannot be cached that way — and a
// version stamp that can lie is worse than none.

import pkg from "../package.json";

/** Short git commit of this deploy, or "dev" off Vercel. */
export function buildSha(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev";
}

/**
 * The version a person reads out: "v1.4". package.json's minor number, bumped
 * by one on every release to main (`npm version minor --no-git-tag-version`;
 * the rule is in CLAUDE.md). The patch number never shows.
 *
 * Counting commits instead would bump itself, but the deploy server's copy
 * of the repository can be shallow — measured here, a shallow clone counted
 * 71 commits where the full history had 128 — so the number would go
 * backwards. A hand-bumped number can only fail by NOT changing, and the
 * "up to date?" check never relies on it: that compares commits.
 */
export function appVersion(): string {
  const [major, minor] = pkg.version.split(".");
  return `v${major}.${minor}`;
}
