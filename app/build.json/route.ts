import { buildSha } from "@/lib/build-id";

/**
 * The build the SERVER is on right now, for Settings to compare against the
 * build the phone is running. Per request and never cached: a cached answer
 * would say "up to date" about whichever deploy happened to be cached.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    { sha: buildSha() },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
