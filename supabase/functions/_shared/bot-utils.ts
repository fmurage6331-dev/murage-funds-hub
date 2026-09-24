export type Channel = "whatsapp" | "sms";
export type JoinRole = "member" | "board_member" | "secretary" | "assistant_secretary";
export type JoinStep = "start" | "name" | "role" | "email" | "confirm";

/** A Kenyan mobile number, stored without a +. Reject foreign/ambiguous input. */
export function normalizePhone(phone: string): string {
  const digits = phone.trim().replace(/[\s()+-]/g, "");
  const normalized = digits.startsWith("254")
    ? digits
    : digits.startsWith("0")
      ? `254${digits.slice(1)}`
      : `254${digits}`;
  if (!/^254[17][0-9]{8}$/.test(normalized)) {
    throw new Error("Invalid Kenyan phone number");
  }
  return normalized;
}

export function parseDeposit(text: string): { amount: number; ref: string } | null {
  const match = /^DEPOSIT\s+([1-9][0-9]*(?:\.[0-9]{1,2})?)\s+([A-Z0-9]{6,20})$/i.exec(text.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount > 100_000_000) return null;
  return { amount, ref: match[2].toUpperCase() };
}

export const joinRoles: Record<string, JoinRole> = {
  "1": "member",
  "2": "board_member",
  "3": "secretary",
  "4": "assistant_secretary",
};

export function validName(value: string): boolean {
  return value.length >= 2 && value.length <= 100 && /^[\p{L}][\p{L}\p{M}\p{N} .'-]*$/u.test(value);
}

export function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function money(amount: number): string {
  return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 }).format(amount);
}

export function kenyaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (part: string) => parts.find((item) => item.type === part)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function kenyaDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  });
}
