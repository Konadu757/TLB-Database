import { createFileRoute } from "@tanstack/react-router";

import {
  inviteSendResultToJson,
  parseInviteEmailBody,
  sendInviteEmailWithResend,
} from "@/lib/access/invite-send-server";

export const Route = createFileRoute("/api/invite-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
        }

        const parsed = parseInviteEmailBody(raw);
        if (!parsed) {
          return Response.json(
            {
              ok: false,
              error: "Body must include to, name, inviteCode, and inviteLink.",
            },
            { status: 400 },
          );
        }

        const result = await sendInviteEmailWithResend(parsed);
        // Always 200 when body parsed — clients read ok/notConfigured (502 looked like a gateway crash).
        return Response.json(inviteSendResultToJson(result), { status: 200 });
      },
    },
  },
});
