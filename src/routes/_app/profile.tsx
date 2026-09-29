import { createFileRoute } from "@tanstack/react-router";

import { ProfilePage } from "@/components/profile-page";

export const Route = createFileRoute("/_app/profile")({
  head: () => ({
    meta: [
      { title: "Profile | TLB Enterprise" },
      {
        name: "description",
        content: "Signed-in profile for the TLB Enterprise workspace.",
      },
    ],
  }),
  component: ProfilePage,
});
