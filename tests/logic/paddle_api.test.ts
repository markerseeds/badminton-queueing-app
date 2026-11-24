import { describe, expect, it } from "vitest";
import {
  createPaddleApi,
  PaddleApiError,
  paddleConfigFrom,
} from "../../supabase/functions/_shared/paddleApi.ts";

// The Edge Functions' only door to Paddle's REST API. Tested against a fake
// fetch rather than the sandbox: there are no Paddle credentials yet, and what
// matters here is the shape of every request (which environment, which
// headers, which body) and how Paddle's errors come back — both checkable
// without the network.

type Call = { method: string; url: string; headers: Headers; body: unknown };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, meta: { request_id: "req_test" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function paddleError(status: number, code: string, detail: string): Response {
  return new Response(
    JSON.stringify({ error: { type: "request_error", code, detail }, meta: { request_id: "req_test" } }),
    { status, headers: { "content-type": "application/json" } },
  );
}

const SANDBOX_KEY = "pdl_sdbx_apikey_LOCAL-TEST-ONLY";
const LIVE_KEY = "pdl_live_apikey_LOCAL-TEST-ONLY";

describe("paddleConfigFrom", () => {
  it("talks to the sandbox or the live API as PADDLE_ENV says", () => {
    expect(paddleConfigFrom({ PADDLE_ENV: "sandbox", PADDLE_API_KEY: SANDBOX_KEY })).toEqual({
      apiKey: SANDBOX_KEY,
      baseUrl: "https://sandbox-api.paddle.com",
      environment: "sandbox",
    });
    expect(paddleConfigFrom({ PADDLE_ENV: "production", PADDLE_API_KEY: LIVE_KEY })).toEqual({
      apiKey: LIVE_KEY,
      baseUrl: "https://api.paddle.com",
      environment: "production",
    });
  });

  // No default, deliberately. Guessing "sandbox" would make a live deploy that
  // forgot the variable fail quietly; guessing "production" would point a test
  // setup at real money. Missing configuration is an error a person must see.
  it("refuses a missing or unknown PADDLE_ENV, and a missing key", () => {
    expect(() => paddleConfigFrom({ PADDLE_API_KEY: SANDBOX_KEY })).toThrow(/PADDLE_ENV/);
    expect(() => paddleConfigFrom({ PADDLE_ENV: "live", PADDLE_API_KEY: LIVE_KEY })).toThrow(/PADDLE_ENV/);
    expect(() => paddleConfigFrom({ PADDLE_ENV: "sandbox" })).toThrow(/PADDLE_API_KEY/);
  });

  // Paddle's keys say which environment they belong to. Crossing them over
  // would fail on Paddle's side anyway, but only on the first customer's click.
  it("refuses a key that belongs to the other environment", () => {
    expect(() => paddleConfigFrom({ PADDLE_ENV: "production", PADDLE_API_KEY: SANDBOX_KEY })).toThrow(
      /sandbox key/,
    );
    expect(() => paddleConfigFrom({ PADDLE_ENV: "sandbox", PADDLE_API_KEY: LIVE_KEY })).toThrow(
      /live key/,
    );
  });
});

describe("createPaddleApi", () => {
  const config = paddleConfigFrom({ PADDLE_ENV: "sandbox", PADDLE_API_KEY: SANDBOX_KEY });

  it("sends the key as a bearer token and pins Paddle-Version 1", async () => {
    const { fetch, calls } = fakeFetch(() => ok({ id: "txn_1", status: "draft" }));
    await createPaddleApi(config, fetch).getTransaction("txn_1");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("https://sandbox-api.paddle.com/transactions/txn_1");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${SANDBOX_KEY}`);
    expect(calls[0].headers.get("paddle-version")).toBe("1");
  });

  it("reuses the Paddle customer that already has this email", async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.method === "GET" ? ok([{ id: "ctm_existing", email: "sam+club@example.com" }]) : ok({}),
    );

    const id = await createPaddleApi(config, fetch).findOrCreateCustomer("sam+club@example.com");

    expect(id).toBe("ctm_existing");
    expect(calls).toHaveLength(1);
    // `+` must survive the query string, or Paddle looks up a different address.
    expect(calls[0].url).toBe(
      "https://sandbox-api.paddle.com/customers?email=sam%2Bclub%40example.com",
    );
  });

  it("creates a customer when none has this email", async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.method === "GET" ? ok([]) : ok({ id: "ctm_new", email: "sam@example.com" }, 201),
    );

    const id = await createPaddleApi(config, fetch).findOrCreateCustomer("sam@example.com");

    expect(id).toBe("ctm_new");
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(calls[1].url).toBe("https://sandbox-api.paddle.com/customers");
    expect(calls[1].body).toEqual({ email: "sam@example.com" });
  });

  // Two checkouts started at once both see "no customer" and both create one;
  // Paddle refuses the second with a conflict, and the answer is to look again.
  it("looks the customer up again when creating one loses a race", async () => {
    let lookups = 0;
    const { fetch } = fakeFetch((call) => {
      if (call.method === "GET") {
        lookups++;
        return ok(lookups === 1 ? [] : [{ id: "ctm_raced", email: "sam@example.com" }]);
      }
      return paddleError(409, "customer_already_exists", "customer email conflicts with customer of id ctm_raced");
    });

    const id = await createPaddleApi(config, fetch).findOrCreateCustomer("sam@example.com");

    expect(id).toBe("ctm_raced");
    expect(lookups).toBe(2);
  });

  it("creates a transaction for one unit of the price, attached to the customer", async () => {
    const { fetch, calls } = fakeFetch(() => ok({ id: "txn_new", status: "draft" }, 201));

    const txn = await createPaddleApi(config, fetch).createTransaction({
      priceId: "pri_pro",
      customerId: "ctm_1",
      customData: { user_id: "u-1", app: "badminton-queue" },
    });

    expect(txn).toEqual({ id: "txn_new", status: "draft" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://sandbox-api.paddle.com/transactions");
    expect(calls[0].body).toEqual({
      items: [{ price_id: "pri_pro", quantity: 1 }],
      customer_id: "ctm_1",
      custom_data: { user_id: "u-1", app: "badminton-queue" },
      collection_mode: "automatic",
    });
  });

  it("turns a Paddle error into a PaddleApiError carrying status, code and detail", async () => {
    const { fetch } = fakeFetch(() => paddleError(403, "forbidden", "You aren't permitted to perform this request."));

    const error = await createPaddleApi(config, fetch)
      .getTransaction("txn_1")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaddleApiError);
    expect(error).toMatchObject({ status: 403, code: "forbidden" });
    expect((error as Error).message).toMatch(/You aren't permitted/);
  });

  it("survives an error body that isn't JSON", async () => {
    const { fetch } = fakeFetch(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    const error = await createPaddleApi(config, fetch)
      .getTransaction("txn_1")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaddleApiError);
    expect(error).toMatchObject({ status: 502 });
  });
});
