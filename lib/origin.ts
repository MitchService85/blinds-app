/**
 * The address a link or redirect should carry: the production one, never
 * whatever this page happens to be open at.
 *
 * Every deployment of this app answers at several addresses — the production
 * domain, a branch alias, a per-deploy URL — and Vercel Authentication walls
 * off all but the production domain from anyone who is not signed in to
 * Vercel. A crew member can open the app at any of them (a link in a Vercel
 * email, say) and see no difference. But a PM link built from that address
 * sends an outsider straight into the wall, which on a phone looks like the
 * site not loading (2026-09-10, the first PM link for Arbour House). A magic
 * sign-in link built the same way lands on the wrong address too.
 *
 * Vercel hands the build the production hostname; when it is absent (a
 * self-hosted or local build) the current address is the only one there is.
 */
export function productionOrigin(current: string): string {
  const host = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return current;
  return `https://${host.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}
