import type { Metadata } from "next";

/**
 * The PM page is a client component, so its metadata lives here. A PM pastes
 * the link into a text or an email: the tab and the preview should say what
 * it is ("Install progress", not the crew app's "Measure"). The token in the
 * URL is the whole authorisation, so the page is kept out of search indexes
 * and its address is not sent as a referrer to any link it opens.
 */
export const metadata: Metadata = {
  title: "Install progress",
  description: "Unit-by-unit install status from your blinds installer",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PmLayout({ children }: LayoutProps<"/pm/[token]">) {
  return children;
}
