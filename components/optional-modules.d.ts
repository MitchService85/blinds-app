// Ambient fallback types for sibling-agent modules (lib/export/, lib/sync/)
// built concurrently by other agents on this same build. TypeScript only
// falls back to these when the real path-mapped module can't be resolved on
// disk; once/while the real files exist, their actual exports win and these
// are ignored. Every call site that touches these modules still
// feature-detects at runtime (dynamic import + typeof checks) rather than
// trusting these loose types, so this is pure build-safety insurance against
// the file briefly not existing.
declare module "@/lib/export/exporter" {
  export function exportFloorToBlob(input: unknown): Promise<Blob>;
  export function suggestedFilename(input: unknown): string;
}

declare module "@/lib/sync" {
  export function useSyncStatus(): {
    state: "local-only" | "synced" | "pending" | "offline" | "error";
    pendingCount: number;
    signedIn: boolean;
    signIn: (email: string) => Promise<{ error: string | null }>;
    verify: (email: string, code: string) => Promise<{ error: string | null }>;
    signOut: () => Promise<void>;
  };
  export function forceSync(): Promise<void>;
  export function isSyncConfigured(): boolean;
}
