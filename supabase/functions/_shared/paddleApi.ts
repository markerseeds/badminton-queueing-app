// The Edge Functions' only door to Paddle's REST API (Paddle Billing, API
// version 1). Plain fetch, with the fetch itself injectable so vitest can check
// every request without the network.

export type PaddleEnvironment = "sandbox" | "production";

export type PaddleConfig = {
  apiKey: string;
  baseUrl: string;
  environment: PaddleEnvironment;
};

const BASE_URLS: Record<PaddleEnvironment, string> = {
  sandbox: "https://sandbox-api.paddle.com",
  production: "https://api.paddle.com",
};

// Reads PADDLE_ENV and PADDLE_API_KEY. There is no default environment on
// purpose: guessing "sandbox" would make a live deploy that forgot the variable
// fail quietly, and guessing "production" would point a test setup at real
// money. The names match Paddle.js's own `environment` values.
export function paddleConfigFrom(env: {
  PADDLE_ENV?: string;
  PADDLE_API_KEY?: string;
}): PaddleConfig {
  const environment = env.PADDLE_ENV;
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error(
      `PADDLE_ENV must be "sandbox" or "production" (got ${JSON.stringify(environment ?? null)})`,
    );
  }
  const apiKey = env.PADDLE_API_KEY;
  if (!apiKey) throw new Error("PADDLE_API_KEY is not set");

  // Paddle's keys name their environment. Crossing them over would fail on
  // Paddle's side too — but only on the first real customer's click.
  if (environment === "production" && apiKey.includes("_sdbx_")) {
    throw new Error("PADDLE_ENV is production but PADDLE_API_KEY is a sandbox key");
  }
  if (environment === "sandbox" && apiKey.includes("_live_")) {
    throw new Error("PADDLE_ENV is sandbox but PADDLE_API_KEY is a live key");
  }

  return { apiKey, baseUrl: BASE_URLS[environment], environment };
}

export class PaddleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly detail: string | null,
  ) {
    super(`Paddle API ${status}${code ? ` ${code}` : ""}: ${detail ?? "no detail"}`);
    this.name = "PaddleApiError";
  }
}

export type PaddleTransaction = Record<string, unknown> & { id: string; status: string };

export function createPaddleApi(
  config: PaddleConfig,
  fetchImpl: typeof fetch = fetch,
) {
  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetchImpl(`${config.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        // Pinned so a new default API version can't change response shapes
        // under a deployed function.
        "paddle-version": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // An HTML error page from something in front of Paddle; keep the status.
    }

    if (!res.ok) {
      const error = (parsed as { error?: { code?: string; detail?: string } } | null)?.error;
      throw new PaddleApiError(res.status, error?.code ?? null, error?.detail ?? (text.slice(0, 200) || null));
    }
    return (parsed as { data?: unknown } | null)?.data;
  }

  async function findCustomerByEmail(email: string): Promise<string | null> {
    // An exact-match filter, so `+` must reach Paddle as a plus, not a space.
    const data = await request("GET", `/customers?email=${encodeURIComponent(email)}`);
    const first = Array.isArray(data) ? (data[0] as { id?: string } | undefined) : undefined;
    return first?.id ?? null;
  }

  return {
    findCustomerByEmail,

    // One Paddle customer per email, reused across purchases, so Paddle's own
    // receipts and refunds line up with one account.
    async findOrCreateCustomer(email: string): Promise<string> {
      const existing = await findCustomerByEmail(email);
      if (existing) return existing;
      try {
        const created = (await request("POST", "/customers", { email })) as { id: string };
        return created.id;
      } catch (e) {
        // Two checkouts started at once both found nothing and both created;
        // Paddle refuses the second as a conflict. Look again rather than fail.
        if (e instanceof PaddleApiError && e.status === 409) {
          const raced = await findCustomerByEmail(email);
          if (raced) return raced;
        }
        throw e;
      }
    },

    // Left without an address on purpose, so it is created as `draft`: Paddle's
    // overlay checkout collects the country/postcode tax needs, and only then
    // can it be paid. The browser receives just the id.
    async createTransaction(input: {
      priceId: string;
      customerId: string;
      customData: Record<string, string>;
    }): Promise<{ id: string; status: string }> {
      const txn = (await request("POST", "/transactions", {
        items: [{ price_id: input.priceId, quantity: 1 }],
        customer_id: input.customerId,
        custom_data: input.customData,
        collection_mode: "automatic",
      })) as { id: string; status: string };
      return { id: txn.id, status: txn.status };
    },

    async getTransaction(id: string): Promise<PaddleTransaction> {
      return (await request("GET", `/transactions/${encodeURIComponent(id)}`)) as PaddleTransaction;
    },
  };
}

export type PaddleApi = ReturnType<typeof createPaddleApi>;
