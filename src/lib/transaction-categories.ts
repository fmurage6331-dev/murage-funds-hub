/** Income categories shared by the transaction ledger and donor recording form. */
export const INCOME_CATEGORIES = [
  "Donation",
  "Grant",
  "Fundraiser",
  "Interest",
  "Other income",
] as const;

/** Existing income category used for donor gifts. */
export const DONATION_CATEGORY = INCOME_CATEGORIES[0];
