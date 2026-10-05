import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  formatCloudInviteFailureNote,
  initialInviteDelivery,
  looksLikePhoneNumber,
  trySendInviteEmail,
  trySendInviteSms,
  validateInvitePhone,
  type InviteDeliveryStatus,
  type SendClientResult,
} from "@/lib/access/invite-delivery";
import {
  acceptInviteOnSupabase,
  createInviteOnSupabase,
  fetchStaffAccessStatusesFromSupabase,
  validateInviteOnSupabase,
} from "@/lib/access/supabase-invites";
import { buildInviteLink, normalizeAccessCode } from "@/lib/domain/invites";
import { dbRoleCodeForRoleId, isPortalOwnerAuth } from "@/lib/domain/permissions";
import type { AppUser, DeliveryStatus, Permission, TlbState } from "@/lib/domain/types";
import { createTlbRepository } from "@/lib/repo/tlb-repository";
import { can as canPerm } from "@/lib/store/tlb-store";
import { bindSessionToAuthIdentity } from "@/lib/store/migrate";
import {
  readPortalSession,
  subscribePortalAuth,
} from "@/lib/auth/portal-auth";

/** Re-read tlb.user_roles / invite role_code for the signed-in Auth user. */
async function cloudRoleCodeForAuthSession(input: {
  userId: string;
  email: string;
}): Promise<string | null> {
  if (isPortalOwnerAuth({ authUserId: input.userId, email: input.email })) {
    return "OWNER";
  }
  const cloud = await fetchStaffAccessStatusesFromSupabase();
  if (!cloud.ok || !cloud.data.length) return null;
  const email = input.email.trim().toLowerCase();
  const byId = cloud.data.find(
    (row) => (row.profileId ?? "").trim() === input.userId.trim(),
  );
  if (byId?.roleCode) return byId.roleCode;
  const byEmail = cloud.data.find(
    (row) => (row.email ?? "").trim().toLowerCase() === email,
  );
  return byEmail?.roleCode ?? null;
}
import {
  assignUserRole,
  cancelOrderLine,
  confirmCustomerOrder,
  createCustomerOrder,
  createDeliveryFromSupply,
  createInvoiceFromSupply,
  createOrdinaryReceipt,
  createReceiptFromSupply,
  createQuotation,
  updateQuotation,
  createRole,
  createSupply,
  deleteRole,
  getOutstandingRows,
  loadState,
  markDelivered,
  markNotificationRead,
  markNotificationsRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteNotifications,
  purgeTrashItem,
  receiveStock,
  recordPayment,
  refreshOpsNotifications,
  releaseReservation,
  reserveForOutstanding,
  restoreTrashItem,
  softDeleteRecord,
  acceptInvite,
  applyHostedInviteAcceptance,
  previewLocalInvite,
  issueUserInvite,
  updateAgeingSettings,
  updateCompanyProfile,
  updateDeliveryStatus,
  updateRole,
  upsertAppUser,
  upsertCustomer,
  upsertSupplier,
  upsertVatRate,
  saveTaxRates,
} from "@/lib/store/tlb-store";
import {
  advanceTransfer,
  createGoodsReceipt,
  createStockIssue,
  decideApproval,
  postStockAdjustment,
  requestWarehouseTransfer,
} from "@/lib/store/inventory-store";
import {
  createCustomerReturn,
  createNonPoPurchase,
  createSupplierReturn,
  decideNonPoPurchase,
  receiveImportShipment,
  receiveNonPoPurchase,
  softDeleteOpsRecord,
  upsertExportShipment,
  upsertImportShipment,
} from "@/lib/store/ops-extended-store";
import {
  acknowledgeOpsRequest,
  advanceOpsDriverStatus,
  assignOpsDriver,
  autoReviewOpsLines,
  cancelOpsRequest,
  confirmOpsDeliveryReceipt,
  confirmOpsWarehouseCollection,
  createOpsRequest,
  decideOpsRequestApproval,
  markOpsReadyForCollection,
  postOpsMessage,
  prepareOpsRequest,
  releaseOpsGoods,
  reviewOpsWarehouse,
  submitOpsRequest,
  updateOpsRequestDraft,
  upsertOpsDriver,
} from "@/lib/store/ops-hub-store";
import type { TransferStatus } from "@/lib/domain/types";

type MutFn = (
  state: TlbState,
) => { ok: true; data: { state: TlbState; data: unknown } } | { ok: false; error: string };

export type LastStaffInvite = {
  userId: string;
  name: string;
  email: string;
  contact?: string;
  inviteToken: string;
  inviteCode: string;
  inviteLink: string;
  delivery: InviteDeliveryStatus;
};

const SAVE_DEBOUNCE_MS = 450;

function inviteSnapshot(
  user: AppUser,
  delivery: InviteDeliveryStatus,
): LastStaffInvite | null {
  if (!user.inviteToken || !user.inviteCode) return null;
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    ...(user.contact ? { contact: user.contact } : {}),
    inviteToken: user.inviteToken,
    inviteCode: user.inviteCode,
    inviteLink: buildInviteLink(user.inviteToken),
    delivery,
  };
}

export function useTlbStore() {
  const repo = useMemo(() => createTlbRepository(), []);
  const [state, setState] = useState<TlbState>(() => loadState());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastInvite, setLastInvite] = useState<LastStaffInvite | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextPersist = useRef(true);
  /** Trash / purge / restore must flush before refresh can resurrect rows. */
  const pendingImmediateSave = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await repo.load();
        if (cancelled) return;
        const session = await readPortalSession();
        const roleCode = session
          ? await cloudRoleCodeForAuthSession({
              userId: session.userId,
              email: session.email,
            })
          : null;
        if (cancelled) return;
        const bound = session?.email
          ? bindSessionToAuthIdentity(loaded, {
              email: session.email,
              authUserId: session.userId,
              roleCode,
            })
          : loaded;
        // Persist identity/role heal so cloud auth_directory cannot keep
        // resurrecting Owner (or wrong person) on the next hydrate.
        skipNextPersist.current = bound === loaded;
        setState(bound);
        setHydrated(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setPersistError(`Failed to load from ${repo.backend}: ${message}`);
        setState(loadState());
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  useEffect(() => {
    if (!hydrated) return;
    return subscribePortalAuth((session) => {
      if (!session?.email) return;
      void (async () => {
        const roleCode = await cloudRoleCodeForAuthSession({
          userId: session.userId,
          email: session.email,
        });
        setState((prev) =>
          bindSessionToAuthIdentity(prev, {
            email: session.email,
            authUserId: session.userId,
            roleCode,
          }),
        );
      })();
    });
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const delay = pendingImmediateSave.current ? 0 : SAVE_DEBOUNCE_MS;
    pendingImmediateSave.current = false;
    saveTimer.current = setTimeout(() => {
      setSaving(true);
      void repo
        .save(state)
        .then(() => {
          // Remote sync failures are silent (local snapshot already kept) — never banner.
          setPersistError(null);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const lower = message.toLowerCase();
          // Hybrid cloud/network soft-fails must never reach Flash banners.
          if (
            lower.includes("failed to fetch") ||
            lower.includes("cloud sync") ||
            lower.includes("network")
          ) {
            console.warn("[useTlbStore] save soft-failed (local kept):", message);
            setPersistError(null);
            return;
          }
          setPersistError(`Save to ${repo.backend} failed: ${message}`);
        })
        .finally(() => setSaving(false));
    }, delay);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, hydrated, repo]);

  const apply = useCallback((fn: MutFn, successMessage?: string): boolean | string => {
    setError(null);
    setNotice(null);
    let failed: string | null = null;
    let entityId: string | null = null;
    setState((prev) => {
      const result = fn(prev);
      if (!result.ok) {
        failed = result.error;
        entityId = null;
        return prev;
      }
      const data = result.data.data;
      if (data && typeof data === "object") {
        const rec = data as { id?: unknown; requestId?: unknown };
        if (typeof rec.id === "string") entityId = rec.id;
        else if (typeof rec.requestId === "string") entityId = rec.requestId;
        else entityId = null;
      } else {
        entityId = null;
      }
      return result.data.state;
    });
    if (failed) {
      setError(failed);
      return false;
    }
    if (successMessage) setNotice(successMessage);
    return entityId ?? true;
  }, []);

  const applyTrashMutation = useCallback(
    (fn: MutFn, successMessage?: string): boolean | string => {
      pendingImmediateSave.current = true;
      return apply(fn, successMessage);
    },
    [apply],
  );

  const applyCapture = useCallback((fn: MutFn, successMessage?: string) => {
    setError(null);
    setNotice(null);
    let failed: string | null = null;
    let captured: unknown = null;
    setState((prev) => {
      const result = fn(prev);
      if (!result.ok) {
        failed = result.error;
        return prev;
      }
      captured = result.data.data;
      return result.data.state;
    });
    if (failed) {
      setError(failed);
      return { ok: false as const, data: null };
    }
    if (successMessage) setNotice(successMessage);
    return { ok: true as const, data: captured };
  }, []);

  const patchLastInviteDelivery = (
    userId: string,
    patch: Partial<InviteDeliveryStatus>,
  ) => {
    setLastInvite((prev) => {
      if (!prev || prev.userId !== userId) return prev;
      return { ...prev, delivery: { ...prev.delivery, ...patch } };
    });
  };

  const deliverStaffInvite = (user: AppUser, replacesToken?: string) => {
    if (!user.inviteToken || !user.inviteCode) {
      setError(
        "User saved, but invite code/link was not generated — email and SMS were not sent. Try Re-issue on the staff row.",
      );
      setNotice(null);
      return;
    }
    const inviteLink = buildInviteLink(user.inviteToken);
    const willPublishCloud = repo.backend === "supabase";
    const roleName =
      state.roles.find((role) => role.id === user.roleId && !role.deletedAt)?.name ??
      undefined;
    const delivery = initialInviteDelivery({
      name: user.name,
      inviteCode: user.inviteCode,
      inviteToken: user.inviteToken,
      ...(user.contact ? { contact: user.contact } : {}),
      willPublishCloud,
    });
    const snap = inviteSnapshot(user, delivery);
    // Paint code/link + chips immediately — never wait on cloud/email/SMS.
    if (snap) setLastInvite(snap);
    setNotice(
      "Invitation ready below — copy the code or link now. Email and SMS are sending in the background.",
    );
    setError(null);

    const phone = user.contact?.trim();
    const willTrySms = Boolean(phone && looksLikePhoneNumber(phone));
    /** Must exceed client SMS/deliver budget (~28s) so chips are not false-failed early. */
    const DELIVERY_WATCHDOG_MS = 32_000;
    let emailSettled = false;
    let smsSettled = !willTrySms;
    let cloudSettled = !willPublishCloud;

    const watchdog = window.setTimeout(() => {
      if (!emailSettled) {
        emailSettled = true;
        patchLastInviteDelivery(user.id, {
          email: "failed",
          emailNote:
            "Email status timed out — copy the invite below, then use Retry. If this keeps happening, hard-refresh the portal.",
        });
      }
      if (willTrySms && !smsSettled) {
        smsSettled = true;
        patchLastInviteDelivery(user.id, {
          sms: "failed",
          smsNote: `SMS status timed out for ${phone} — copy the SMS text below, then use Retry.`,
        });
      }
      if (willPublishCloud && !cloudSettled) {
        cloudSettled = true;
        patchLastInviteDelivery(user.id, {
          cloud: "failed",
          cloudNote:
            "Cloud save timed out. Access code and link below still work on this browser — try Re-issue again if other devices need the code.",
        });
      }
    }, DELIVERY_WATCHDOG_MS);

    const applyEmailResult = (result: SendClientResult) => {
      emailSettled = true;
      if (result.ok) {
        const deliveryWord =
          result.delivery === "delivered"
            ? "delivered"
            : result.delivery === "bounced"
              ? "bounced"
              : "accepted";
        const detail = [
          deliveryWord === "delivered"
            ? `Email delivered to ${user.email}`
            : `Email accepted for ${user.email}`,
          result.provider ? `via ${result.provider}` : "",
          result.messageId ? `(id ${result.messageId})` : "",
          deliveryWord === "accepted"
            ? "— not bounced yet; check spam if missing"
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        patchLastInviteDelivery(user.id, {
          email: "sent",
          emailNote: `${detail}.`,
        });
        return;
      }
      if (result.notConfigured) {
        patchLastInviteDelivery(user.id, {
          email: "not_configured",
          emailNote:
            "Email was not sent — Resend is not configured. Copy the link or code below. On Vercel set RESEND_API_KEY and RESEND_FROM_EMAIL (server only, never VITE_*), then redeploy.",
        });
        return;
      }
      patchLastInviteDelivery(user.id, {
        email: "failed",
        emailNote: `Email was not sent: ${result.error}. Copy the invite below.`,
      });
    };

    const applySmsResult = (result: SendClientResult) => {
      smsSettled = true;
      if (result.ok) {
        const deliveryWord =
          result.delivery === "delivered"
            ? "delivered"
            : "accepted";
        const detail = [
          deliveryWord === "delivered"
            ? `SMS delivered to ${phone}`
            : `SMS accepted for ${phone}`,
          result.provider ? `via ${result.provider}` : "",
          result.messageId ? `(id ${result.messageId})` : "",
          deliveryWord === "accepted" ? "— awaiting network delivery" : "",
        ]
          .filter(Boolean)
          .join(" ");
        patchLastInviteDelivery(user.id, {
          sms: "sent",
          smsNote: `${detail}.`,
        });
        return;
      }
      if (result.notConfigured) {
        patchLastInviteDelivery(user.id, {
          sms: "not_configured",
          smsNote: `SMS was not sent — SMS is not configured. Contact on file: ${phone}. Copy the SMS text below. On Vercel set ARKESEL_API_KEY and ARKESEL_SENDER_ID (Termii TERMII_* or Twilio TWILIO_* as fallback; server only, never VITE_*), then redeploy.`,
        });
        return;
      }
      patchLastInviteDelivery(user.id, {
        sms: "failed",
        smsNote: `SMS was not sent: ${result.error}. Copy the SMS text below.`,
      });
    };

    const inviteCode = user.inviteCode;

    // After paint: cloud + email/SMS are strictly fire-and-forget.
    // Email and SMS run as separate posts so the email chip can settle without
    // waiting for a slow Arkesel response (combined route would couple them).
    const startBackgroundDelivery = () => {
      if (willPublishCloud) {
        const roleCode = dbRoleCodeForRoleId(user.roleId);
        if (!roleCode) {
          cloudSettled = true;
          patchLastInviteDelivery(user.id, {
            cloud: "failed",
            cloudNote:
              "Cloud invite failed: predefined system roles only. Local code and link below still work on this browser.",
          });
        } else {
          void createInviteOnSupabase({
            email: user.email,
            fullName: user.name,
            roleCode,
            token: user.inviteToken!,
            accessCode: user.inviteCode!,
            ...(replacesToken ? { replacesToken } : {}),
            ...(user.contact?.trim() ? { phone: user.contact.trim() } : {}),
          })
            .then((result) => {
              cloudSettled = true;
              if (result.ok) {
                patchLastInviteDelivery(user.id, {
                  cloud: "ok",
                  cloudNote: "Cloud invite saved. Share the code or link below.",
                });
                return;
              }
              patchLastInviteDelivery(user.id, {
                cloud: "failed",
                cloudNote: formatCloudInviteFailureNote(result.error),
              });
            })
            .catch((err: unknown) => {
              cloudSettled = true;
              const message = err instanceof Error ? err.message : String(err);
              patchLastInviteDelivery(user.id, {
                cloud: "failed",
                cloudNote: formatCloudInviteFailureNote(message),
              });
            });
        }
      }

      void trySendInviteEmail({
        to: user.email,
        name: user.name,
        inviteCode,
        inviteLink,
        ...(roleName ? { role: roleName } : {}),
      })
        .then((email) => {
          applyEmailResult(email);
          if (emailSettled && smsSettled && cloudSettled) {
            window.clearTimeout(watchdog);
          }
          if (email.ok) {
            setNotice((prev) =>
              prev && prev.startsWith("Invitation ready")
                ? `Invitation ready below. Email sent to ${user.email}${willTrySms ? " · SMS still sending…" : "."}`
                : prev,
            );
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          applyEmailResult({ ok: false, error: message });
        });

      if (willTrySms && phone) {
        void trySendInviteSms({
          to: phone,
          name: user.name,
          inviteCode,
          inviteLink,
          body: delivery.smsBody,
        })
          .then((sms) => {
            applySmsResult(sms);
            if (emailSettled && smsSettled && cloudSettled) {
              window.clearTimeout(watchdog);
            }
            if (sms.ok) {
              setNotice(
                `Invitation ready below. Email and SMS delivery finished — copy the code/link if needed.`,
              );
            }
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            applySmsResult({ ok: false, error: message });
          });
      } else if (emailSettled && smsSettled && cloudSettled) {
        window.clearTimeout(watchdog);
      }
    };

    // Yield to the browser so Assign/Re-issue unlocks and the invite panel paints
    // before create_invite / Resend / Arkesel start competing for the main thread.
    window.setTimeout(startBackgroundDelivery, 0);
  };

  const retryInviteChannel = (channel: "email" | "sms") => {
    const invite = lastInvite;
    if (!invite?.inviteCode || !invite.inviteToken) return;

    const staff = state.users.find((u) => u.id === invite.userId);
    const roleName = staff
      ? state.roles.find((role) => role.id === staff.roleId && !role.deletedAt)?.name
      : undefined;

    if (channel === "email") {
      patchLastInviteDelivery(invite.userId, {
        email: "pending",
        emailNote: "Retrying email…",
      });
      void trySendInviteEmail({
        to: invite.email,
        name: invite.name,
        inviteCode: invite.inviteCode,
        inviteLink: invite.inviteLink,
        ...(roleName ? { role: roleName } : {}),
      }).then((result) => {
        if (result.ok) {
          patchLastInviteDelivery(invite.userId, {
            email: "sent",
            emailNote: `Email sent to ${invite.email}.`,
          });
          return;
        }
        if (result.notConfigured) {
          patchLastInviteDelivery(invite.userId, {
            email: "not_configured",
            emailNote:
              "Email was not sent — Resend is not configured. Copy the link or code below. On Vercel set RESEND_API_KEY and RESEND_FROM_EMAIL (server only, never VITE_*), then redeploy.",
          });
          return;
        }
        patchLastInviteDelivery(invite.userId, {
          email: "failed",
          emailNote: `Email was not sent: ${result.error}. Copy the invite below.`,
        });
      });
      return;
    }

    const phone = invite.contact?.trim();
    if (!phone || !looksLikePhoneNumber(phone)) {
      patchLastInviteDelivery(invite.userId, {
        sms: "skipped",
        smsNote: invite.delivery.smsNote,
      });
      return;
    }
    patchLastInviteDelivery(invite.userId, {
      sms: "pending",
      smsNote: `Retrying SMS to ${phone}…`,
    });
    void trySendInviteSms({
      to: phone,
      name: invite.name,
      inviteCode: invite.inviteCode,
      inviteLink: invite.inviteLink,
      body: invite.delivery.smsBody,
    }).then((result) => {
      if (result.ok) {
        patchLastInviteDelivery(invite.userId, {
          sms: "sent",
          smsNote: `SMS sent to ${phone}.`,
        });
        return;
      }
      if (result.notConfigured) {
        patchLastInviteDelivery(invite.userId, {
          sms: "not_configured",
          smsNote: `SMS was not sent — SMS is not configured. Contact on file: ${phone}. Copy the SMS text below. On Vercel set ARKESEL_API_KEY and ARKESEL_SENDER_ID (Termii TERMII_* or Twilio TWILIO_* as fallback; server only, never VITE_*), then redeploy.`,
        });
        return;
      }
      patchLastInviteDelivery(invite.userId, {
        sms: "failed",
        smsNote: `SMS was not sent: ${result.error}. Copy the SMS text below.`,
      });
    });
  };

  const outstanding = useMemo(() => getOutstandingRows(state), [state]);

  return {
    state,
    hydrated,
    saving,
    backend: repo.backend,
    error: error ?? persistError,
    notice,
    lastInvite,
    persistError,
    clearLastInvite: () => setLastInvite(null),
    clearMessages: () => {
      setError(null);
      setNotice(null);
      setPersistError(null);
    },
    retryInviteChannel,
    outstanding,
    can: (permission: Permission) => canPerm(state, permission),
    saveCustomer: (input: Parameters<typeof upsertCustomer>[1]) =>
      apply((s) => upsertCustomer(s, input), "Customer saved."),
    saveSupplier: (input: Parameters<typeof upsertSupplier>[1]) =>
      apply((s) => upsertSupplier(s, input), "Supplier saved."),
    createOrder: (input: Parameters<typeof createCustomerOrder>[1]) =>
      apply((s) => createCustomerOrder(s, input), "Customer order created."),
    createQuotation: (input: Parameters<typeof createQuotation>[1]) =>
      apply((s) => createQuotation(s, input), "Quotation created."),
    updateQuotation: (
      quotationId: string,
      input: Parameters<typeof updateQuotation>[2],
    ) => apply((s) => updateQuotation(s, quotationId, input), "Quotation updated."),
    confirmOrder: (orderId: string, creditOverrideReason?: string) =>
      apply((s) => confirmCustomerOrder(s, orderId, creditOverrideReason), "Order confirmed."),
    cancelLine: (lineId: string, reason: string) =>
      apply(
        (s) => cancelOrderLine(s, lineId, reason),
        "Outstanding quantity cancelled with reason.",
      ),
    supply: (orderId: string, lines: Parameters<typeof createSupply>[2], notes?: string) =>
      apply((s) => createSupply(s, orderId, lines, notes), "Supply posted."),
    receive: (productId: string, warehouseId: string, qty: number) =>
      apply(
        (s) => receiveStock(s, productId, warehouseId, qty, true),
        "Stock received and reserved for outstanding orders.",
      ),
    postGrn: (input: Parameters<typeof createGoodsReceipt>[1]) =>
      apply((s) => createGoodsReceipt(s, input), "Goods receipt posted to ledger."),
    postIssue: (input: Parameters<typeof createStockIssue>[1]) =>
      apply((s) => createStockIssue(s, input), "Stock issue posted."),
    requestTransfer: (input: Parameters<typeof requestWarehouseTransfer>[1]) =>
      apply((s) => requestWarehouseTransfer(s, input), "Transfer requested."),
    advanceTransfer: (transferId: string, toStatus: TransferStatus) =>
      apply((s) => advanceTransfer(s, transferId, toStatus), "Transfer updated."),
    postAdjustment: (input: Parameters<typeof postStockAdjustment>[1]) =>
      apply((s) => postStockAdjustment(s, input), "Adjustment saved."),
    decideApproval: (approvalId: string, decision: "Approved" | "Rejected", note?: string) =>
      apply((s) => {
        const appr = s.approvals.find((a) => a.id === approvalId);
        if (appr?.refType === "ops_request" && appr.status === "Pending") {
          return decideOpsRequestApproval(s, appr.refId, decision, { note });
        }
        return decideApproval(s, approvalId, decision, note);
      }, `Approval ${decision.toLowerCase()}.`),
    createOpsRequest: (input: Parameters<typeof createOpsRequest>[1]) =>
      apply((s) => createOpsRequest(s, input), "Ops request saved."),
    updateOpsDraft: (requestId: string, input: Parameters<typeof updateOpsRequestDraft>[2]) =>
      apply((s) => updateOpsRequestDraft(s, requestId, input), "Draft updated."),
    submitOpsRequest: (requestId: string) =>
      apply((s) => submitOpsRequest(s, requestId), "Request submitted."),
    acknowledgeOpsRequest: (requestId: string) =>
      apply((s) => acknowledgeOpsRequest(s, requestId), "Request acknowledged."),
    decideOpsApproval: (
      requestId: string,
      decision: "Approved" | "Rejected" | "Partial",
      input?: Parameters<typeof decideOpsRequestApproval>[3],
    ) =>
      apply(
        (s) => decideOpsRequestApproval(s, requestId, decision, input),
        `Ops ${decision.toLowerCase()}.`,
      ),
    autoReviewOps: (requestId: string) =>
      apply((s) => autoReviewOpsLines(s, requestId), "Warehouse availability reviewed."),
    reviewOpsWarehouse: (requestId: string, input: Parameters<typeof reviewOpsWarehouse>[2]) =>
      apply((s) => reviewOpsWarehouse(s, requestId, input), "Warehouse review saved."),
    prepareOps: (requestId: string, input: Parameters<typeof prepareOpsRequest>[2]) =>
      apply((s) => prepareOpsRequest(s, requestId, input), "Preparation saved."),
    markOpsReady: (requestId: string) =>
      apply((s) => markOpsReadyForCollection(s, requestId), "Ready for collection."),
    releaseOpsGoods: (requestId: string, input?: Parameters<typeof releaseOpsGoods>[2]) =>
      apply((s) => releaseOpsGoods(s, requestId, input), "Goods released — ledger posted."),
    assignOpsDriver: (requestId: string, driverId: string, vehicle?: string) =>
      apply((s) => assignOpsDriver(s, requestId, driverId, vehicle), "Driver assigned."),
    advanceOpsDriver: (
      requestId: string,
      toStatus: Parameters<typeof advanceOpsDriverStatus>[2],
      note?: string,
    ) =>
      apply((s) => advanceOpsDriverStatus(s, requestId, toStatus, note), "Driver status updated."),
    confirmOpsWarehouseCollect: (requestId: string) =>
      apply((s) => confirmOpsWarehouseCollection(s, requestId), "Warehouse collection confirmed."),
    confirmOpsDelivery: (
      requestId: string,
      input: Parameters<typeof confirmOpsDeliveryReceipt>[2],
    ) => apply((s) => confirmOpsDeliveryReceipt(s, requestId, input), "Delivery receipt recorded."),
    postOpsMessage: (
      requestId: string,
      body: string,
      chip?: Parameters<typeof postOpsMessage>[3],
    ) => apply((s) => postOpsMessage(s, requestId, body, chip), "Message posted."),
    cancelOpsRequest: (requestId: string, reason: string) =>
      apply((s) => cancelOpsRequest(s, requestId, reason), "Request cancelled."),
    saveOpsDriver: (input: Parameters<typeof upsertOpsDriver>[1]) =>
      apply((s) => upsertOpsDriver(s, input), "Driver saved."),
    postCustomerReturn: (input: Parameters<typeof createCustomerReturn>[1]) =>
      apply((s) => createCustomerReturn(s, input), "Customer return posted to ledger."),
    postSupplierReturn: (input: Parameters<typeof createSupplierReturn>[1]) =>
      apply((s) => createSupplierReturn(s, input), "Supplier return posted to ledger."),
    createNonPo: (input: Parameters<typeof createNonPoPurchase>[1]) =>
      apply((s) => createNonPoPurchase(s, input), "Non-PO submitted for approval."),
    decideNonPo: (nonPoId: string, decision: "Approved" | "Rejected", note?: string) =>
      apply(
        (s) => decideNonPoPurchase(s, nonPoId, decision, note),
        `Non-PO ${decision.toLowerCase()}.`,
      ),
    receiveNonPo: (nonPoId: string) =>
      apply((s) => receiveNonPoPurchase(s, nonPoId), "Non-PO goods received (GRN)."),
    upsertImport: (input: Parameters<typeof upsertImportShipment>[1]) =>
      apply((s) => upsertImportShipment(s, input), "Import shipment saved."),
    receiveImport: (shipmentId: string) =>
      apply((s) => receiveImportShipment(s, shipmentId), "Import received to warehouse."),
    upsertExport: (input: Parameters<typeof upsertExportShipment>[1]) =>
      apply((s) => upsertExportShipment(s, input), "Export shipment saved."),
    moveOpsToTrash: (input: Parameters<typeof softDeleteOpsRecord>[1]) =>
      applyTrashMutation((s) => softDeleteOpsRecord(s, input), "Moved to trash."),
    reserve: (productId: string, warehouseId: string) =>
      apply(
        (s) => reserveForOutstanding(s, productId, warehouseId),
        "Stock reserved against outstanding orders.",
      ),
    releaseReservation: (id: string, reason?: string) =>
      apply((s) => releaseReservation(s, id, reason), "Reservation released."),
    deliver: (orderId: string) =>
      apply((s) => markDelivered(s, orderId), "Order marked delivered."),
    setAgeing: (
      normalMaxDays: number,
      attentionMaxDays: number,
      extendedUnfulfilledDays?: number,
      expectedApproachingDays?: number,
    ) =>
      apply(
        (s) =>
          updateAgeingSettings(
            s,
            normalMaxDays,
            attentionMaxDays,
            extendedUnfulfilledDays,
            expectedApproachingDays,
          ),
        "Ageing thresholds updated.",
      ),
    saveCompany: (company: Parameters<typeof updateCompanyProfile>[1]) =>
      apply((s) => updateCompanyProfile(s, company), "Company profile saved."),
    saveVatRate: (input: Parameters<typeof upsertVatRate>[1]) =>
      apply((s) => upsertVatRate(s, input), "Tax rate saved."),
    saveTaxRates: (rates: Parameters<typeof saveTaxRates>[1]) =>
      apply((s) => saveTaxRates(s, rates), "Tax settings saved."),
    createRole: (input: Parameters<typeof createRole>[1]) =>
      apply((s) => createRole(s, input), "Role created."),
    updateRole: (roleId: string, input: Parameters<typeof updateRole>[2]) =>
      apply((s) => updateRole(s, roleId, input), "Role updated."),
    deleteRole: (roleId: string, reason?: string) =>
      applyTrashMutation((s) => deleteRole(s, roleId, reason), "Role moved to trash."),
    deactivateRole: (roleId: string, reason?: string) =>
      applyTrashMutation((s) => deleteRole(s, roleId, reason), "Role moved to trash."),
    assignUserRole: (userId: string, roleId: string) =>
      apply((s) => assignUserRole(s, userId, roleId), "User role assigned."),
    saveUser: (input: Parameters<typeof upsertAppUser>[1]) => {
      const contact = input.contact?.trim() ?? "";
      if (contact) {
        const phoneCheck = validateInvitePhone(contact);
        if (!phoneCheck.ok) {
          setError(phoneCheck.error);
          setNotice(null);
          return false;
        }
      }
      const result = applyCapture(
        (s) => upsertAppUser(s, input),
        input.id
          ? "Staff details saved. Email/SMS were NOT sent — click Re-issue on the staff row to deliver the invite."
          : "Role assigned — invitation ready below; sending email/SMS in background…",
      );
      if (result.ok && !input.id && result.data) {
        deliverStaffInvite(result.data as AppUser);
      }
      return result.ok;
    },
    issueUserInvite: (userId: string) => {
      const staff = state.users.find((user) => user.id === userId);
      const contact = staff?.contact?.trim() ?? "";
      if (contact) {
        const phoneCheck = validateInvitePhone(contact);
        if (!phoneCheck.ok) {
          setError(phoneCheck.error);
          setNotice(null);
          return false;
        }
      }
      const previousToken = staff?.inviteToken;
      const result = applyCapture(
        (s) => issueUserInvite(s, userId),
        "Invite re-issued — code ready below; sending email/SMS in background…",
      );
      if (result.ok && result.data) {
        deliverStaffInvite(result.data as AppUser, previousToken);
      }
      return result.ok;
    },
    validateInvite: async (input: { token?: string; code?: string }) => {
      const token = input.token?.trim() || undefined;
      const code = input.code?.trim() || undefined;
      const normalizedCode = code ? normalizeAccessCode(code) : "";
      const byToken = token ? state.users.find((user) => user.inviteToken === token) : undefined;
      const byCode = normalizedCode
        ? state.users.find(
            (user) => user.inviteCode && normalizeAccessCode(user.inviteCode) === normalizedCode,
          )
        : undefined;
      if (byToken && byCode && byToken.id !== byCode.id) {
        setError("Invite link and access code do not match.");
        setNotice(null);
        return { ok: false as const, data: null };
      }
      const localUser = byToken ?? byCode;
      const inviteArgs: { token?: string; code?: string } = {
        ...(token ? { token } : {}),
        ...(code ? { code } : {}),
      };

      if (repo.backend === "supabase") {
        const hosted = await validateInviteOnSupabase(inviteArgs);
        if (hosted.ok) {
          setError(null);
          setNotice(null);
          return { ok: true as const, data: hosted.data };
        }
        const missingRpc =
          /Could not find the function public\.validate_invite/i.test(hosted.error) ||
          /schema cache/i.test(hosted.error);
        const cloudMiss =
          /invalid invite/i.test(hosted.error) ||
          /invite expired/i.test(hosted.error) ||
          /invite already used/i.test(hosted.error) ||
          /Invalid or expired invite/i.test(hosted.error);
        if ((missingRpc || cloudMiss) && localUser) {
          const local = previewLocalInvite(state, inviteArgs);
          if (local.ok && local.data) {
            setError(null);
            setNotice(null);
            return {
              ok: true as const,
              data: {
                email: local.data.data.email,
                fullName: local.data.data.fullName,
                roleCode: local.data.data.roleCode ?? "local",
                ...(local.data.data.accessCode
                  ? { accessCode: local.data.data.accessCode }
                  : {}),
                ...(local.data.data.contact ? { contact: local.data.data.contact } : {}),
              },
            };
          }
        }
        setError(
          missingRpc
            ? "Cloud invite check is not set up on the database yet. Ask an Owner to apply the invite password SQL, then Re-issue."
            : cloudMiss && !localUser
              ? "Invalid or expired invite. Ask an Owner to Re-issue a fresh code."
              : hosted.error,
        );
        setNotice(null);
        return { ok: false as const, data: null };
      }

      const local = previewLocalInvite(state, inviteArgs);
      if (!local.ok) {
        setError(local.error);
        setNotice(null);
        return { ok: false as const, data: null };
      }
      setError(null);
      setNotice(null);
      return {
        ok: true as const,
        data: {
          email: local.data.data.email,
          fullName: local.data.data.fullName,
          roleCode: local.data.data.roleCode ?? "local",
          ...(local.data.data.accessCode ? { accessCode: local.data.data.accessCode } : {}),
          ...(local.data.data.contact ? { contact: local.data.data.contact } : {}),
        },
      };
    },
    acceptInvite: async (input: Parameters<typeof acceptInvite>[1]) => {
      const password = input.password ?? "";
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        setNotice(null);
        return { ok: false as const, data: null };
      }
      if (repo.backend === "supabase") {
        const token = input.token?.trim() || undefined;
        const code = input.code?.trim() || undefined;
        const normalizedCode = code ? normalizeAccessCode(code) : "";
        const byToken = token ? state.users.find((user) => user.inviteToken === token) : undefined;
        const byCode = normalizedCode
          ? state.users.find(
              (user) => user.inviteCode && normalizeAccessCode(user.inviteCode) === normalizedCode,
            )
          : undefined;
        if (byToken && byCode && byToken.id !== byCode.id) {
          setError("Invite link and access code do not match.");
          setNotice(null);
          return { ok: false as const, data: null };
        }
        const localUser = byToken ?? byCode;
        if (localUser && !localUser.active) {
          setError("User account is inactive.");
          setNotice(null);
          return { ok: false as const, data: null };
        }
        const acceptArgs = {
          password,
          ...(token ? { token } : {}),
          ...(code ? { code } : {}),
        };
        const hosted = await acceptInviteOnSupabase(acceptArgs);
        if (hosted.ok) {
          const applied = applyCapture(
            (s) => applyHostedInviteAcceptance(s, hosted.data),
            "Invite activated. Signing you in…",
          );
          if (applied.ok) {
            return { ok: true as const, data: hosted.data };
          }
          return { ok: false as const, data: null };
        }
        // Never fall back to local accept when the cloud refused a same-email / Owner collision —
        // that path would leave the browser signed in as invitee while Auth is still Owner.
        const emailCollision =
          /already belongs to the Owner account/i.test(hosted.error) ||
          /already registered/i.test(hosted.error) ||
          /already has a sign-in account/i.test(hosted.error) ||
          /use a (different|unique) email/i.test(hosted.error) ||
          /cannot accept invite for an existing account/i.test(hosted.error);
        if (emailCollision) {
          setError(
            /Owner account/i.test(hosted.error)
              ? "This invite email belongs to the Owner account. Ask an Owner to invite you with a different email — one email can only be one login."
              : "This invite email is already registered to another account. Ask an Owner to invite you with a unique email.",
          );
          setNotice(null);
          return { ok: false as const, data: null };
        }
        // Hosted RPC missing, unreachable, or cloud row never saved (create_invite failed):
        // fall back to local invite acceptance when this browser still holds the pending invite.
        // SMS recipients on other devices need a Re-issue after cloud create_invite works.
        const missingRpc =
          /Could not find the function public\.accept_invite/i.test(hosted.error) ||
          /Could not find the function/i.test(hosted.error) ||
          /schema cache/i.test(hosted.error) ||
          /function public\.accept_invite/i.test(hosted.error);
        const cloudMiss =
          /invalid invite/i.test(hosted.error) ||
          /invite expired/i.test(hosted.error) ||
          /Invalid or expired invite/i.test(hosted.error);
        if ((missingRpc || cloudMiss) && localUser) {
          const local = applyCapture(
            (s) => acceptInvite(s, acceptArgs),
            "Signed in (this browser).",
          );
          if (local.ok) {
            setNotice(
              missingRpc
                ? "Activated on this browser only. Ask an Owner to apply the invite password SQL on Supabase, then Re-issue for other devices."
                : "Activated on this browser. Cloud invite was missing — ask an Owner to Re-issue so other devices can use the code.",
            );
            setError(null);
            return {
              ok: true as const,
              data: {
                profileId: localUser.id,
                email: localUser.email,
                fullName: localUser.name,
                roleCode: "local",
              },
            };
          }
        }
        setError(
          missingRpc && !localUser
            ? "Cloud invite activation needs a database update (password setup). Ask an Owner to apply the invite password SQL, then Re-issue."
            : cloudMiss && !localUser
              ? "Invalid or expired invite. Ask an Owner to Re-issue a fresh code (cloud sync must succeed first)."
              : hosted.error,
        );
        setNotice(null);
        return { ok: false as const, data: null };
      }
      const local = applyCapture((s) => acceptInvite(s, input), "Invite activated.");
      if (!local.ok) return { ok: false as const, data: null };
      const accepted = local.data as AppUser | null;
      return {
        ok: true as const,
        data: accepted
          ? {
              profileId: accepted.id,
              email: accepted.email,
              fullName: accepted.name,
              roleCode: "local",
            }
          : null,
      };
    },
    createInvoice: (input: Parameters<typeof createInvoiceFromSupply>[1]) =>
      apply((s) => createInvoiceFromSupply(s, input), "VAT invoice created."),
    createReceipt: (input: Parameters<typeof createOrdinaryReceipt>[1]) =>
      apply((s) => createOrdinaryReceipt(s, input), "Receipt created."),
    createReceiptFromSupply: (input: Parameters<typeof createReceiptFromSupply>[1]) =>
      apply((s) => createReceiptFromSupply(s, input), "Receipt created from supply."),
    createDelivery: (input: Parameters<typeof createDeliveryFromSupply>[1]) =>
      apply((s) => createDeliveryFromSupply(s, input), "Delivery created."),
    setDeliveryStatus: (
      id: string,
      status: DeliveryStatus,
      confirmation?: { receiverName?: string; notes?: string },
    ) =>
      apply((s) => updateDeliveryStatus(s, id, status, confirmation), "Delivery status updated."),
    recordPayment: (input: Parameters<typeof recordPayment>[1]) =>
      apply((s) => recordPayment(s, input), "Payment recorded."),
    readNotification: (id: string) => apply((s) => markNotificationRead(s, id)),
    /** Mark visible/open-panel notifications as viewed so the header unread badge decreases. */
    readNotifications: (ids: string[]) => apply((s) => markNotificationsRead(s, ids)),
    markAllNotificationsRead: (ids?: string[]) =>
      apply((s) => markAllNotificationsRead(s, ids), "Notifications marked as read."),
    deleteNotification: (id: string) =>
      applyTrashMutation((s) => deleteNotification(s, id), "Notification deleted."),
    deleteNotifications: (ids: string[]) =>
      applyTrashMutation((s) => deleteNotifications(s, ids), "Notifications deleted."),
    refreshNotifications: () => apply((s) => refreshOpsNotifications(s)),
    moveToTrash: (input: Parameters<typeof softDeleteRecord>[1]) =>
      applyTrashMutation((s) => softDeleteRecord(s, input), "Moved to trash."),
    restoreFromTrash: (input: Parameters<typeof restoreTrashItem>[1]) =>
      applyTrashMutation((s) => restoreTrashItem(s, input), "Restored from trash."),
    purgeFromTrash: (input: Parameters<typeof purgeTrashItem>[1]) =>
      applyTrashMutation((s) => purgeTrashItem(s, input), "Permanently deleted."),
  };
}

export type TlbStoreApi = ReturnType<typeof useTlbStore>;
