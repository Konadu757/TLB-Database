import { createFileRoute } from "@tanstack/react-router";

import { PortalGate } from "@/components/portal-gate";
import { TLBDashboard } from "@/components/tlb-dashboard";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <PortalGate>
      <TLBDashboard />
    </PortalGate>
  );
}
