import { createFileRoute } from "@tanstack/react-router";

import { looksLikePhoneNumber, validateInvitePhone } from "@/lib/access/invite-phone";
import {
  inviteSendResultToJson,
  parseInviteSmsBody,
  sendInviteSms,
} from "@/lib/access/invite-send-server";

export const Route = createFileRoute("/api/invite-sms")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
        }

        const parsed = parseInviteSmsBody(raw);
        if (!parsed) {
          return Response.json(
            {
              ok: false,
              error: "Body must include to, name, inviteCode, and inviteLink.",
            },
            { status: 400 },
          );
        }

        if (!looksLikePhoneNumber(parsed.to)) {
          const checked = validateInvitePhone(parsed.to);
          return Response.json(
            {
              ok: false,
              error: checked.ok
                ? "Contact does not look like a phone number."
                : checked.error,
            },
            { status: 400 },
          );
        }

        const phoneCheck = validateInvitePhone(parsed.to);
        if (!phoneCheck.ok) {
          return Response.json({ ok: false, error: phoneCheck.error }, { status: 400 });
        }

        const smsBody =
          parsed.body?.trim() ||
          `TLB access for ${parsed.name}: code ${parsed.inviteCode}. Open ${parsed.inviteLink}`;

        const result = await sendInviteSms({
          to: parsed.to,
          body: smsBody,
        });

        // Always 200 when body parsed — clients read ok/notConfigured (avoid 502 gateway noise).
        return Response.json(inviteSendResultToJson(result), { status: 200 });
      },
    },
  },
});
