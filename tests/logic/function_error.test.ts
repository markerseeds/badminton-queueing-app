import { describe, expect, it } from "vitest";
import { functionErrorFrom } from "../../app/lib/functionError";

// supabase-js reports any non-2xx from an Edge Function as a generic
// "Edge Function returned a non-2xx status code", with the Response tucked into
// `error.context`. The functions answer refusals as {error, code} — and the
// code is what lets the pricing page tell "you already have Pro" (good news)
// from a real failure — so it has to be dug back out.

function httpError(body: string, status: number) {
  return Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(body, { status, headers: { "content-type": "application/json" } }),
  });
}

describe("functionErrorFrom", () => {
  it("surfaces the function's own message and code", async () => {
    const e = await functionErrorFrom(
      httpError(JSON.stringify({ error: "This account already has Pro.", code: "already_pro" }), 409),
      "fallback",
    );
    expect(e.message).toBe("This account already has Pro.");
    expect(e).toMatchObject({ code: "already_pro" });
  });

  it("falls back when the body isn't the functions' JSON", async () => {
    const e = await functionErrorFrom(httpError("<html>502</html>", 502), "Couldn't start checkout.");
    expect(e.message).toBe("Couldn't start checkout.");
    expect((e as { code?: string }).code).toBeUndefined();
  });

  // FunctionsFetchError: the request never got an answer.
  it("falls back for a network failure", async () => {
    const e = await functionErrorFrom(
      Object.assign(new Error("Failed to send a request to the Edge Function"), {
        name: "FunctionsFetchError",
        context: new TypeError("fetch failed"),
      }),
      "Couldn't reach the server.",
    );
    expect(e.message).toBe("Couldn't reach the server.");
  });
});
