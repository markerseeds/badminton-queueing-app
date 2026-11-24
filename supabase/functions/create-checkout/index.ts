// POST /functions/v1/create-checkout — called by the pricing page (through
// sessionStore.createCheckout) when a signed-in organizer taps Buy. Answers
// {transactionId}, which the browser hands to Paddle.js to open the overlay.
//
// JWT verification stays on at the gateway; the handler then re-reads the
// account through auth.getUser so `is_anonymous` is current.

import { handleCreateCheckout } from "../_shared/checkout.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { createPaddleApi, paddleConfigFrom, type PaddleApi } from "../_shared/paddleApi.ts";
import {
  accountPlanWith,
  adminClient,
  applyEventWith,
  env,
  getUserWith,
  insertPendingWith,
  listPendingWith,
} from "../_shared/runtime.ts";
import { sentryReporter } from "../_shared/sentry.ts";
import { syncPendingPurchases } from "../_shared/sync.ts";

const reporter = sentryReporter("create-checkout");

// Built when first needed, not at boot: a bad PADDLE_ENV/PADDLE_API_KEY then
// fails one request with a reported error instead of failing the preflight.
let paddleApi: PaddleApi | null = null;
function paddle(): PaddleApi {
  paddleApi ??= createPaddleApi(
    paddleConfigFrom({ PADDLE_ENV: env("PADDLE_ENV"), PADDLE_API_KEY: env("PADDLE_API_KEY") }),
  );
  return paddleApi;
}

Deno.serve(async (req) => {
  try {
    const db = adminClient();
    const priceId = env("PADDLE_PRICE_ID");
    return await handleCreateCheckout(req, {
      priceId,
      appName: "badminton-queue",
      reporter,
      getUser: getUserWith(db),
      accountPlan: accountPlanWith(db),
      reconcile: (userId) =>
        syncPendingPurchases(userId, {
          priceId: priceId ?? "",
          listPending: listPendingWith(db),
          getTransaction: (id) => paddle().getTransaction(id),
          applyEvent: applyEventWith(db),
          accountPlan: accountPlanWith(db),
          reporter,
        }),
      findOrCreateCustomer: (email) => paddle().findOrCreateCustomer(email),
      createTransaction: (input) => paddle().createTransaction(input),
      insertPending: insertPendingWith(db),
    });
  } catch (e) {
    await reporter.exception(e);
    return json({ error: "Couldn't start checkout. Please try again.", code: "server_error" }, 500, corsHeaders);
  }
});
