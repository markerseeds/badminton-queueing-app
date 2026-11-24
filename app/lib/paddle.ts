// The single Paddle.js module, in the same spirit as sessionStore.ts and auth.ts:
// nothing else in the app imports @paddle/paddle-js.
//
// Paddle.js runs the checkout overlay and localizes the price, and that's all
// it is trusted with. What is SOLD is decided on the server: create-checkout
// builds the transaction for its own PADDLE_PRICE_ID, and the browser only ever
// receives that transaction's id. NEXT_PUBLIC_PADDLE_PRICE_ID below is used to
// show a price and for nothing else, so tampering with it changes a label.
//
// The three variables are public by design (a client-side token is not a
// secret, as the anon key isn't). Without them — local dev, a preview build —
// checkout is simply unavailable rather than broken.

import {
  CheckoutEventNames,
  initializePaddle,
  type Environments,
  type Paddle,
  type PaddleEventData,
} from "@paddle/paddle-js";

// Referenced literally so Next inlines them into the browser bundle.
const environment = process.env.NEXT_PUBLIC_PADDLE_ENV;
const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
const priceId = process.env.NEXT_PUBLIC_PADDLE_PRICE_ID;

export function isCheckoutConfigured(): boolean {
  return (
    (environment === "sandbox" || environment === "production") &&
    Boolean(token) &&
    Boolean(priceId)
  );
}

// Paddle.js takes ONE event callback, at initialization, for every checkout the
// page ever opens. The open checkout's listener is swapped in here instead.
let listener: ((event: PaddleEventData) => void) | null = null;
let loading: Promise<Paddle> | null = null;

// Downloads Paddle.js from Paddle's CDN on first use — the only place it may be
// loaded from — and initializes it once.
function paddle(): Promise<Paddle> {
  if (!isCheckoutConfigured()) {
    return Promise.reject(new Error("Checkout isn't set up on this site yet."));
  }
  if (!loading) {
    loading = initializePaddle({
      environment: environment as Environments,
      token: token as string,
      eventCallback: (event) => listener?.(event),
    }).then((instance) => {
      if (!instance) {
        throw new Error("Couldn't load the payment form. Check your connection and try again.");
      }
      return instance;
    });
    // A failed download (offline, an ad blocker) shouldn't poison every retry.
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

// Opens Paddle's overlay on a transaction create-checkout made, and settles as
// soon as Paddle reports the payment complete — while its own success screen is
// still up, so the page can start confirming the plan behind it. Settles
// "closed" if the buyer closes the overlay without paying.
export async function openCheckout(transactionId: string): Promise<"completed" | "closed"> {
  const instance = await paddle();
  return new Promise((resolve) => {
    let completed = false;
    listener = (event) => {
      if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) {
        completed = true;
        resolve("completed");
      } else if (event.name === CheckoutEventNames.CHECKOUT_CLOSED && !completed) {
        listener = null;
        resolve("closed");
      }
    };
    instance.Checkout.open({
      transactionId,
      settings: {
        displayMode: "overlay",
        // The transaction is attached to the account's own Paddle customer.
        // Letting the buyer "log out" of it inside the overlay would pay under
        // an email the account never verified.
        allowLogout: false,
      },
    });
  });
}

// The Pro price in the visitor's own currency, tax included where it applies,
// e.g. "$30.00" or "€27.00". Display only (see the top of this file). Null when
// checkout isn't configured.
export async function getLocalPrice(): Promise<string | null> {
  if (!isCheckoutConfigured()) return null;
  const instance = await paddle();
  const preview = await instance.PricePreview({
    items: [{ priceId: priceId as string, quantity: 1 }],
  });
  return preview.data.details.lineItems[0]?.formattedTotals.total ?? null;
}
