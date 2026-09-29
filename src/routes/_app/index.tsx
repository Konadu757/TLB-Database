import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [
      { title: "TLB Enterprise" },
      {
        name: "description",
        content: "TLB Enterprise operations, inventory, production, sales, and finance dashboard.",
      },
      { property: "og:title", content: "TLB Enterprise Operations Dashboard" },
      {
        property: "og:description",
        content: "A unified internal operating system for TLB Enterprise.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomeRoute,
});

/** Canvas is the dashboard inside the app shell. This route exists so `/` stays a real path. */
function HomeRoute() {
  return null;
}
