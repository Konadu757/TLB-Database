/**
 * Trace the portal sign-in gate.
 * A missing session and a rejected password must not open the dashboard.
 * Run: npx tsx scripts/portal-auth-verify.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  dashboardAllowed,
  sessionFromSignIn,
  SIGN_IN_REQUIRED,
  SIGN_IN_UNREACHABLE,
  signInFailureMessage,
} from "../src/lib/auth/portal-auth";

const rejected = sessionFromSignIn({
  ok: false,
  error: "Invalid login credentials",
});
assert.equal(rejected, null);
assert.equal(dashboardAllowed(rejected), false);
assert.equal(dashboardAllowed(null), false);

const unconfigured = sessionFromSignIn({ ok: false, error: SIGN_IN_REQUIRED });
assert.equal(unconfigured, null);
assert.equal(dashboardAllowed(unconfigured), false);

const accepted = sessionFromSignIn({
  ok: true,
  userId: "auth-user",
  email: "owner@example.com",
});
assert.ok(accepted);
assert.equal(dashboardAllowed(accepted), true);
assert.equal(dashboardAllowed({ userId: "", email: "owner@example.com" }), false);

const layout = readFileSync(new URL("../src/routes/_app.tsx", import.meta.url), "utf8");
const gate = readFileSync(new URL("../src/components/portal-gate.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/lib/auth/portal-auth.ts", import.meta.url), "utf8");
const login = readFileSync(new URL("../src/components/portal-login.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

assert.equal(
  signInFailureMessage({ message: "Failed to fetch", name: "AuthRetryableFetchError", status: 0 }),
  SIGN_IN_UNREACHABLE,
);
assert.equal(
  signInFailureMessage({ message: "Invalid login credentials", status: 400 }),
  "Invalid login credentials",
);
assert.equal(dashboardAllowed(sessionFromSignIn({ ok: false, error: SIGN_IN_UNREACHABLE })), false);
assert.doesNotMatch(login, /The workspace opens only after this sign-in is accepted/);
assert.doesNotMatch(login, /Nothing in the portal is available until this/);
assert.match(login, /Show password/);
assert.match(styles, /\.tlb-login-form input[\s\S]*border-radius:\s*999px/);

assert.match(layout, /<PortalGate>[\s\S]*<TLBDashboard \/>[\s\S]*<\/PortalGate>/);
assert.match(gate, /useState<"checking" \| "closed" \| "open">\("checking"\)/);
assert.match(gate, /if \(phase !== "open"\)/);
assert.match(gate, /sessionFromSignIn\(result\)/);
assert.match(gate, /!result\.ok \|\| !dashboardAllowed\(session\)/);
assert.match(auth, /signInWithPassword/);
assert.match(auth, /discardRestoredSessionIfColdVisit/);
assert.match(auth, /hasTabAuthSession/);
assert.match(auth, /tlb-portal-tab-auth/);
assert.match(gate, /discardRestoredSessionIfColdVisit/);
assert.match(gate, /hasTabAuthSession/);
assert.doesNotMatch(
  auth,
  /lockWorkspaceToOwner|currentUserId|OWNER_USER_ID|service_role|SERVICE_ROLE/,
);
assert.doesNotMatch(gate, /lockWorkspaceToOwner|currentUserId/);

console.log("portal auth gate: cold visit requires login; failed sign-in stays closed");
