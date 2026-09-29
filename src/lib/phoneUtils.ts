/**
 * Phone-number sign-in helpers.
 *
 * Most Murage Foundation members were imported with a phone number and no email
 * address, so they have nothing to type into an email/password form. Rather than
 * adding SMS/OTP, every phone-only member is given a *synthetic* Supabase Auth
 * email derived from their number — `{digits}@murage.foundation` — and signs in
 * by typing the phone number they already know plus the default password.
 *
 * The synthetic address is an internal Auth identifier only: it is never shown
 * to the member, never emailed, and never stored on the `profiles` row (which
 * keeps `email` null for phone-only members).
 *
 * Keep this module dependency-free: it is executed directly by the Node test
 * runner and mirrored by `supabase/functions/_shared/phone.ts`, which the
 * `admin-actions` Edge Function uses to mint the very same addresses.
 */

/** Domain of the synthetic Auth email used for phone-only members. */
export const SYNTHETIC_EMAIL_DOMAIN = "murage.foundation";

/**
 * Password issued to every imported/admin-created member. Members are prompted
 * to replace it (see `DefaultPasswordBanner` and `profiles.is_default_password`).
 */
export const DEFAULT_MEMBER_PASSWORD = "12345678";

/** Separators people type around digits: spaces, dashes, brackets and dots. */
const PHONE_SEPARATORS = /[\s\-().]/g;

/** Anything a member may legitimately type into the "Email or Phone Number" field. */
const PHONE_CHARACTER_PATTERN = /^[\d+\s\-().]+$/;

/**
 * Normalise a typed phone number to E.164.
 *
 * - `0724344102`     → `+254724344102` (Kenyan local format)
 * - `254724344102`   → `+254724344102` (country code without the `+`)
 * - `+254 724 344102`→ `+254724344102` (already international)
 * - `+1 (603) 809-5008` → `+16038095008` (overseas members)
 * - `724344102`      → `+254724344102` (9-digit Kenyan mobile without the leading 0)
 */
export function normalizePhone(input: string): string {
  const phone = input.trim().replace(PHONE_SEPARATORS, "");

  // Kenyan numbers typed in local format.
  if (phone.startsWith("0")) return `+254${phone.slice(1)}`;
  // Kenyan numbers typed with the country code but no `+`.
  if (phone.startsWith("254")) return `+${phone}`;
  // Kenyan mobiles typed without the leading 0 (9 digits, e.g. 724344102).
  if (phone.startsWith("7") && phone.length === 9) return `+254${phone}`;
  // Already international.
  if (phone.startsWith("+")) return phone;
  // Any other country code: assume it was typed without the `+`.
  return `+${phone}`;
}

/**
 * The synthetic Supabase Auth email for a phone number:
 * `+254724344102` → `254724344102@murage.foundation`.
 */
export function phoneToSyntheticEmail(phone: string): string {
  const digits = normalizePhone(phone).replace("+", "");
  return `${digits}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/** True when the value looks like a phone number rather than an email address. */
export function isPhoneNumber(input: string): boolean {
  const value = input.trim();
  return value.length > 0 && !value.includes("@") && PHONE_CHARACTER_PATTERN.test(value);
}

/** True when the value is an email address (contains an `@`). */
export function isEmailAddress(input: string): boolean {
  return input.trim().includes("@");
}

/** True for the internal `@murage.foundation` addresses of phone-only members. */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}

/**
 * Resolve what a member typed into the single sign-in identifier field to the
 * email address Supabase Auth knows them by: a real email is used as typed, a
 * phone number is mapped onto its synthetic address.
 */
export function resolveSignInEmail(input: string): string {
  const value = input.trim();
  return isEmailAddress(value) ? value : phoneToSyntheticEmail(value);
}

/**
 * Phone number carried on the Supabase Auth user metadata, used to label
 * phone-only accounts instead of exposing their synthetic email address.
 */
export function phoneFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).phone_number;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
