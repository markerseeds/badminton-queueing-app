// POST /functions/v1/paddle-webhook — Paddle's notification destination for
// transaction.completed, adjustment.created and adjustment.updated.
//
// Runs with verify_jwt = false (supabase/config.toml): Paddle can't send a
// Supabase JWT, so the Paddle-Signature HMAC is the authentication, checked in
// handlePaddleWebhook before anything else happens. Paddle wants an answer
// within five seconds; one database call takes milliseconds.

import { json } from "../_shared/http.ts";
import { adminClient, applyEventWith, env } from "../_shared/runtime.ts";
import { sentryReporter } from "../_shared/sentry.ts";
import { handlePaddleWebhook } from "../_shared/webhook.ts";

const reporter = sentryReporter("paddle-webhook");

Deno.serve(async (req) => {
  try {
    return await handlePaddleWebhook(req, {
      secret: env("PADDLE_WEBHOOK_SECRET"),
      priceId: env("PADDLE_PRICE_ID"),
      applyEvent: (event, priceId) => applyEventWith(adminClient())(event, priceId),
      reporter,
    });
  } catch (e) {
    // Anything the handler didn't anticipate. 500 so Paddle retries.
    await reporter.exception(e);
    return json({ error: "internal error" }, 500);
  }
});
