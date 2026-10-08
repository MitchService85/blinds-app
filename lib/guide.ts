// The in-app guide: the first-run welcome, the step-by-step tour, and the
// reference topics. Shared here so the welcome, the tour and the "?" links
// on busy screens all agree on step names.

/** Set once the welcome sheet has been answered, any way at all. */
export const WELCOME_DISMISSED_KEY = "measure:welcome:dismissed";

/** Tour steps a person has completed on this device, as a JSON string[]. */
export const TOUR_PROGRESS_KEY = "measure:tour:done";

/** The tour, in order. `id` is what /help/tour?step=… and the "?" links use. */
export const TOUR_STEPS = [
  { id: "jobs", title: "Your jobs" },
  { id: "grid", title: "The unit grid" },
  { id: "measure", title: "Measure a window" },
  { id: "bays", title: "Bay windows" },
  { id: "warnings", title: "Orange warnings" },
  { id: "export", title: "Send it to the factory" },
  { id: "install", title: "Install day" },
  { id: "offline", title: "No signal? No problem" },
] as const;

export type TourStepId = (typeof TOUR_STEPS)[number]["id"];

export function tourHref(step?: TourStepId): string {
  return step ? `/help/tour?step=${step}` : "/help/tour";
}
