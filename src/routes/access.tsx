import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useTlbStore } from "@/lib/store/use-tlb-store";

export const Route = createFileRoute("/access")({
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Access | TLB Enterprise" },
      { name: "description", content: "Activate your TLB staff invite or enter an access code." },
    ],
  }),
  component: AccessPage,
});

function AccessPage() {
  const { invite: inviteToken } = Route.useSearch();
  const navigate = useNavigate();
  const store = useTlbStore();
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!store.hydrated || !inviteToken) return;
    const result = store.acceptInvite({ token: inviteToken });
    if (result.ok) void navigate({ to: "/" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when hydrated + invite link present
  }, [store.hydrated, inviteToken]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <article className="tlb-panel" style={{ width: "100%", maxWidth: 420 }}>
        <div className="tlb-panel-heading">
          <div>
            <span>Access</span>
            <strong>Activate invite</strong>
          </div>
        </div>
        <form
          className="tlb-form-grid"
          style={{ padding: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            const result = store.acceptInvite({
              token: inviteToken,
              code: code.trim() || undefined,
            });
            if (result.ok) {
              void navigate({ to: "/" });
            }
          }}
        >
          <p className="tlb-muted-line tlb-span-2" style={{ margin: 0 }}>
            Enter the access code your administrator sent you, or open the invite link they shared.
            Email is not sent automatically — treat the code like a password.
          </p>
          {inviteToken ? (
            <p className="tlb-muted-line tlb-span-2" style={{ margin: 0 }}>
              Invite link detected — you can sign in with the link alone or confirm with your code.
            </p>
          ) : null}
          <label className="tlb-span-2">
            Access code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="TLB-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {store.error ? (
            <p className="tlb-span-2" style={{ color: "var(--destructive)", margin: 0, fontSize: "0.8125rem" }}>
              {store.error}
            </p>
          ) : null}
          <div className="tlb-form-actions tlb-span-2">
            <Button type="submit" disabled={!store.hydrated || store.saving}>
              {store.hydrated ? "Sign in" : "Loading…"}
            </Button>
          </div>
        </form>
      </article>
    </div>
  );
}
