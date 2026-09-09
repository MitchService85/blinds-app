"use client";

import { useEffect, useState, type ComponentType } from "react";

/**
 * Account panel for Settings — who this phone is signed in as, sync now, and
 * sign out. Mirrors SyncStatus's dynamic-import guard so this component (and
 * the Settings page that renders it) still builds when lib/sync/ is absent.
 */
export function AccountCard() {
  const [Inner, setInner] = useState<ComponentType | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("./account-card-inner")
      .then((mod) => {
        if (!cancelled) setInner(() => mod.AccountCardInner);
      })
      .catch(() => {
        // lib/sync not present in this build — there is no account to show.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return Inner ? <Inner /> : null;
}
