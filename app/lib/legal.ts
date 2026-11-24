// Everything the legal pages need that only the owner can supply, in one place.
//
// Paddle reviews a seller's site before it will take payments for it: the
// terms must name the seller (a business or a sole proprietor) and carry
// Paddle's merchant-of-record clause, and terms, privacy policy and refund
// policy must all be reachable from the site's navigation. The pages are
// drafted around these placeholders; fill them in, read the wording, and set
// `draft` to false before submitting the domain for approval.

export const LEGAL = {
  draft: true,
  sellerName: "[Your legal name or business name]",
  contactEmail: "[contact email address]",
  country: "[country whose law governs these terms]",
  // Paddle handles refunds as the merchant of record; this is the window the
  // seller commits to on top of the buyer's statutory rights.
  refundDays: "[14]",
  lastUpdated: "[date of publication]",
} as const;
