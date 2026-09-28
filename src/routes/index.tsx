import { createFileRoute } from "@tanstack/react-router";
import { TLBDashboard } from "@/components/tlb-dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Executive Dashboard | TLB Enterprise" },
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
  component: Index,
});

function Index() {
  return <TLBDashboard />;
}
