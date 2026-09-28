/**
 * Browser calls for tlb invites. Uses the publishable key only.
 * public.create_invite / public.accept_invite are the Data API names.
 * Neither call sends or stores a service-role key.
 */

import { supabase } from "@/integrations/supabase/client";
import type { HostedInviteAcceptance } from "@/lib/store/tlb-store";

type RpcResult = { data: unknown; error: { message: string } | null };

async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const client = supabase as unknown as {
    rpc: (name: string, params: Record<string, unknown>) => Promise<RpcResult>;
  };
  return client.rpc(fn, args);
}

export async function createInviteOnSupabase(input: {
  email: string;
  fullName: string;
  roleCode: string;
  token: string;
  accessCode: string;
  replacesToken?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data, error } = await rpc("create_invite", {
      p_email: input.email,
      p_full_name: input.fullName,
      p_role_code: input.roleCode,
      p_token: input.token,
      p_access_code: input.accessCode,
      p_expires_at: null,
      p_replaces_token: input.replacesToken ?? null,
    });
    if (error) return { ok: false, error: `Supabase invite was not stored: ${error.message}` };
    if (!data) return { ok: false, error: "Supabase invite was not stored." };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Supabase invite was not stored: ${message}` };
  }
}

export async function acceptInviteOnSupabase(input: {
  token?: string;
  code?: string;
}): Promise<{ ok: true; data: HostedInviteAcceptance } | { ok: false; error: string }> {
  try {
    const { data, error } = await rpc("accept_invite", {
      p_token: input.token ?? null,
      p_access_code: input.code ?? null,
    });
    if (error) return { ok: false, error: error.message };
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "Invalid or expired invite." };
    }
    const row = data as Record<string, unknown>;
    const profileId = typeof row.profile_id === "string" ? row.profile_id : "";
    const email = typeof row.email === "string" ? row.email : "";
    const fullName = typeof row.full_name === "string" ? row.full_name : "";
    const roleCode = typeof row.role_code === "string" ? row.role_code : "";
    if (!profileId || !email || !fullName || !roleCode) {
      return { ok: false, error: "Invalid or expired invite." };
    }
    return { ok: true, data: { profileId, email, fullName, roleCode } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
