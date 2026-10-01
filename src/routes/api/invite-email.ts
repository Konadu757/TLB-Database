import { createFileRoute } from "@tanstack/react-router";

import {
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
        if (result.ok) {
          return Response.json({ ok: true });
        }
        if (result.notConfigured) {
          return Response.json(
            { ok: false, notConfigured: true, error: result.error },
            { status: 503 },
          );
        }
        return Response.json({ ok: false, error: result.error }, { status: 502 });
      },
    },
  },
});
