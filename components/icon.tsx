/**
 * The app's icon set: a dozen hand-drawn strokes in one weight, one size,
 * currentColor. Replaces the emoji that used to stand in for icons — emoji
 * render differently on every phone and read as unfinished on a screen a
 * customer will see. No library: twelve paths do not need a dependency.
 */
export type IconName =
  | "alert"
  | "check"
  | "check-circle"
  | "circle-dot"
  | "note"
  | "camera"
  | "image"
  | "trash"
  | "settings"
  | "more"
  | "close"
  | "copy"
  | "help"
  | "lock";

const PATHS: Record<IconName, React.ReactNode> = {
  alert: (
    <>
      <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.2h.01" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.8 2.8L16.5 9.5" />
    </>
  ),
  "circle-dot": (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  note: (
    <>
      <path d="M14.5 4.5 19.5 9.5 9 20H4v-5L14.5 4.5Z" />
      <path d="m12.5 6.5 5 5" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5h3.2l1.6-2.5h6.4l1.6 2.5H20v10H4v-10Z" />
      <circle cx="12" cy="13.2" r="3.2" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.8" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 17.5 5-5 3.5 3.5 2.5-2.5 4.5 4.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l.8 12.5h9.4L17.5 7" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.5h16M4 12h16M4 16.5h16" />
      <circle cx="9" cy="7.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="8" cy="16.5" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M15 9V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H9" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.8" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.3" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" />
      <path d="M12 17h.01" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  /** Pixel size; 20 fits inline with text-sm, 16 with text-xs. */
  size?: number;
  className?: string;
  /** Give a label only when the icon is the sole content of a control. */
  label?: string;
}

export function Icon({ name, size = 20, className = "", label }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 align-[-0.2em] ${className}`}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {PATHS[name]}
    </svg>
  );
}
