// POST /functions/v1/sync-purchase — "Verify purchase". Checks the caller's
// pending purchases with Paddle and applies any that completed, through the same
// apply_paddle_event the webhook uses. Answers {plan, processing}.

import { corsHeaders, json } from "../_shared/http.ts";
import { createPaddleApi, paddleConfigFrom, type PaddleApi } from "../_shared/paddleApi.ts";
import {
  accountPlanWith,
  adminClient,
  applyEventWith,
  env,
  getUserWith,
  listPendingWith,
} from "../_shared/runtime.ts";
import { sentryReporter } from "../_shared/sentry.ts";
import { handleSyncPurchase, syncPendingPurchases } from "../_shared/sync.ts";

const reporter = sentryReporter("sync-purchase");

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
    return await handleSyncPurchase(req, {
      reporter,
      getUser: getUserWith(db),
      sync: (userId) => {
        // Same refusal as the webhook's: with no price configured a completed
        // purchase would be "not ours". Thrown here, it becomes a reported 500.
        if (!priceId) throw new Error("sync-purchase is missing PADDLE_PRICE_ID");
        return syncPendingPurchases(userId, {
          priceId,
          listPending: listPendingWith(db),
          getTransaction: (id) => paddle().getTransaction(id),
          applyEvent: applyEventWith(db),
          accountPlan: accountPlanWith(db),
          reporter,
        });
      },
    });
  } catch (e) {
    await reporter.exception(e);
    return json(
      { error: "Couldn't check your purchase just now. Please try again.", code: "server_error" },
      500,
      corsHeaders,
    );
  }
});
