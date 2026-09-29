/**
 * Edge-function mirror of `src/lib/phoneUtils.ts`.
 *
 * The `admin-actions` function mints the synthetic Auth email for phone-only
 * members (`{digits}@murage.foundation`) and must produce byte-identical
 * addresses to the client, otherwise a member cannot sign in with the number
 * they were imported with. `tests/phone-utils.test.mjs` asserts the two
 * implementations agree on every documented input, so changing one without the
 * other fails the suite.
 */

/** Domain of the synthetic Auth email used for phone-only members. */
export const SYNTHETIC_EMAIL_DOMAIN = "murage.foundation";

/** Password issued to every imported/admin-created member. */
export const DEFAULT_MEMBER_PASSWORD = "12345678";

/** Separators people type around digits: spaces, dashes, brackets and dots. */
const PHONE_SEPARATORS = /[\s\-().]/g;

/** Normalise a phone number to E.164 (see `src/lib/phoneUtils.ts`). */
export function normalizePhone(input: string): string {
  const phone = input.trim().replace(PHONE_SEPARATORS, "");
  if (phone.startsWith("0")) return `+254${phone.slice(1)}`;
  if (phone.startsWith("254")) return `+${phone}`;
  if (phone.startsWith("7") && phone.length === 9) return `+254${phone}`;
  if (phone.startsWith("+")) return phone;
  return `+${phone}`;
}

/** `+254724344102` → `254724344102@murage.foundation`. */
export function phoneToSyntheticEmail(phone: string): string {
  const digits = normalizePhone(phone).replace("+", "");
  return `${digits}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/** True for the internal `@murage.foundation` addresses of phone-only members. */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}
