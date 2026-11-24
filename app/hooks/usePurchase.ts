"use client";

import { useCallback, useEffect, useState } from "react";
import { getLocalPrice, isCheckoutConfigured, openCheckout } from "../lib/paddle";
import { runPurchase, type PurchaseStage } from "../lib/purchase";
import {
  createCheckout,
  getMyLimits,
  getMyPurchase,
  syncPurchase,
} from "../lib/sessionStore";
import type { MyPurchase, PlanName } from "../lib/types";
import { useAuth } from "./useAuth";

// What the pricing page shows while a purchase is under way.
//   idle        — nothing in progress
//   starting    — asking the server for a checkout
//   checkout    — Paddle's overlay is open
//   confirming  — Paddle says paid; waiting for the plan to change
//   verifying   — Verify purchase is asking the server to check with Paddle
//   pro         — the account just became (or was found to be) Pro
//   delayed     — paid, but Pro hasn't landed yet: "on its way"
export type PurchaseStatus =
  | "idle"
  | "starting"
  | PurchaseStage
  | "verifying"
  | "pro"
  | "delayed";

// The sequence itself lives in lib/purchase.ts, where it's unit-tested; this
// hook only wires it to the account, the server and Paddle.js, and holds what
// the page renders. No optimistic Pro anywhere: the plan shown is always one
// my_limits() returned.
export function usePurchase() {
  const auth = useAuth();
  const { user, isSignedIn, signInWithGoogle } = auth;

  // Keyed by the user it was read for, so nothing read for one account is ever
  // shown for another (or for nobody) after a sign-in or sign-out.
  const [account, setAccount] = useState<{
    userId: string;
    plan: PlanName | null;
    purchase: MyPurchase | null;
  } | null>(null);
  const [price, setPrice] = useState<string | null>(null);
  const [status, setStatus] = useState<PurchaseStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The price is shown to everyone, signed in or not.
  useEffect(() => {
    let active = true;
    getLocalPrice()
      .then((p) => active && setPrice(p))
      .catch(() => {
        // The card falls back to "One-time"; checkout itself reports its own
        // failure if Paddle.js can't load at all.
      });
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async (userId: string) => {
    const [limits, mine] = await Promise.all([getMyLimits(), getMyPurchase()]);
    return { userId, plan: limits?.plan ?? null, purchase: mine };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    load(user.id)
      .then((a) => active && setAccount(a))
      .catch(() => {
        // Free-looking until the next refresh; the buttons still work, and the
        // server decides anyway.
      });
    return () => {
      active = false;
    };
  }, [user, load]);

  const current = user && account?.userId === user.id ? account : null;

  const refresh = async () => {
    if (user) setAccount(await load(user.id));
  };

  const buy = async () => {
    setError(null);
    setNotice(null);
    setStatus("starting");
    try {
      const outcome = await runPurchase({
        signedIn: isSignedIn,
        // Back to this page afterwards. The Phase 3b chain brings an anonymous
        // organizer's rooms along whichever way the sign-in goes.
        signIn: () => signInWithGoogle("/pricing"),
        createCheckout,
        openCheckout,
        getPlan: async () => (await getMyLimits())?.plan ?? null,
        syncPurchase,
        onStage: setStatus,
      });
      if (outcome === "signing-in") return; // the browser is on its way to Google
      if (outcome === "closed") {
        setStatus("idle");
        return;
      }
      await refresh().catch(() => {});
      setStatus(outcome === "pro" ? "pro" : "delayed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout. Please try again.");
      setStatus("idle");
    }
  };

  const verify = async () => {
    setError(null);
    setNotice(null);
    setStatus("verifying");
    try {
      const result = await syncPurchase();
      await refresh().catch(() => {});
      if (result.plan === "pro") {
        setStatus("pro");
      } else if (result.processing) {
        setStatus("delayed");
      } else {
        setStatus("idle");
        setNotice(
          "No completed payment found for this account yet. If you've only just " +
            "paid, give it a minute and try again.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check your purchase. Please try again.");
      setStatus("idle");
    }
  };

  return {
    authLoading: auth.loading,
    isSignedIn,
    plan: current?.plan ?? null,
    purchase: current?.purchase ?? null,
    price,
    configured: isCheckoutConfigured(),
    status,
    // A refused sign-in is reported by useAuth itself.
    error: error ?? auth.error,
    notice,
    dismiss: () => {
      setError(null);
      setNotice(null);
      auth.dismissError();
    },
    buy,
    verify,
  };
}
