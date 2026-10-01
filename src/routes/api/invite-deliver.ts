import { createFileRoute } from "@tanstack/react-router";

import {
  deliverInviteChannels,
  inviteSendResultToJson,
  parseInviteDeliverBody,
} from "@/lib/access/invite-send-server";

export const Route = createFileRoute("/api/invite-deliver")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
        }

        const parsed = parseInviteDeliverBody(raw);
        if (!parsed) {
          return Response.json(
            {
              ok: false,
              error: "Body must include to, name, inviteCode, and inviteLink.",
            },
            { status: 400 },
          );
        }

        const { email, sms } = await deliverInviteChannels(parsed);
        const emailJson = inviteSendResultToJson(email);
        const smsJson = sms ? inviteSendResultToJson(sms) : null;
        const bothOk = email.ok && (sms === null || sms.ok);

        return Response.json(
          {
            ok: bothOk,
            email: emailJson,
            sms: smsJson,
          },
          // Always 200 when the body parsed — per-channel ok/error lives in email/sms.
          { status: 200 },
        );
      },
    },
  },
});
