// Per-device UI preferences in localStorage: which jobs are expanded, the
// floor's Measure/Install mode, the keypad's precision.
//
// Every one of these is a convenience, so a failure to read or write must
// never be anything more than "the preference wasn't remembered". Browser
// storage can throw outright — Safari with "Block All Cookies" on, a locked-
// down profile, a full quota — and an unguarded getItem in a mount effect
// takes the whole screen down with it.

/** The stored string, or null when there is none or storage is unavailable. */
export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Best effort: a preference that cannot be saved is simply not remembered. */
export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do — see above.
  }
}
