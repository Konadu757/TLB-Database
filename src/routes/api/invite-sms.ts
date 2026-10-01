import { createFileRoute } from "@tanstack/react-router";

import { looksLikePhoneNumber } from "@/lib/access/invite-phone";
import {
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
          return Response.json(
            {
              ok: false,
              error: "Contact does not look like a phone number.",
            },
            { status: 400 },
          );
        }

        const smsBody =
          parsed.body?.trim() ||
          `TLB access for ${parsed.name}: code ${parsed.inviteCode}. Open ${parsed.inviteLink}`;

        const result = await sendInviteSms({
          to: parsed.to,
          body: smsBody,
        });

        if (result.ok) {
          return Response.json({
            ok: true,
            ...(result.messageId ? { messageId: result.messageId } : {}),
            ...(result.provider ? { provider: result.provider } : {}),
          });
        }
        if (result.notConfigured) {
          return Response.json(
            { ok: false, notConfigured: true, error: result.error },
            { status: 503 },
          );
        }
        return Response.json(
          {
            ok: false,
            error: result.error,
            ...(result.messageId ? { messageId: result.messageId } : {}),
            ...(result.provider ? { provider: result.provider } : {}),
          },
          { status: 502 },
        );
      },
    },
  },
});
