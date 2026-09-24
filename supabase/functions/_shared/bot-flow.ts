import { joinRoles, validEmail, validName, type JoinRole, type JoinStep } from "./bot-utils.ts";

export type Collected = { name?: string; role?: JoinRole; email?: string | null };
export type JoinResult = {
  action: "save" | "keep" | "complete" | "cancel";
  step: JoinStep;
  collected: Collected;
  reply: string;
};

const COMMANDS = new Set([
  "JOIN",
  "BAL",
  "LOANS",
  "DEPOSIT",
  "SCHEDULE",
  "PENDING",
  "CONFIRM",
  "HELP",
  "STOP",
]);
export const INCOMPLETE =
  "You have an incomplete registration.\nReply YES to continue or NO to cancel.";

export function sessionExpired(expiresAt: string, now = Date.now()): boolean {
  return new Date(expiresAt).getTime() <= now;
}

export function promptFor(step: JoinStep, collected: Collected): string {
  switch (step) {
    case "start":
    case "name":
      return "Welcome to Murage Foundation! 🌟\nWhat is your full name?";
    case "role":
      return "Choose your requested role:\n1 = Member\n2 = Board Member\n3 = Secretary\n4 = Assistant Secretary\nReply with 1, 2, 3 or 4.";
    case "email":
      return "What is your email address? Reply SKIP for phone-only membership (bot access only).";
    case "confirm":
      return `Please confirm your registration:\nName: ${collected.name ?? "—"}\nRole: ${collected.role?.replace(/_/g, " ") ?? "—"}\nEmail: ${collected.email ?? "None - Phone Only"}\n\nReply YES to consent to membership data processing and bot messages under Kenya's Data Protection Act, or NO to cancel.`;
  }
}

export function advanceJoin(step: JoinStep, collected: Collected, text: string): JoinResult {
  const input = text.trim();
  const upper = input.toUpperCase();
  const same = (reply: string): JoinResult => ({ action: "keep", step, collected, reply });
  if (upper === "NO")
    return {
      action: "cancel",
      step,
      collected,
      reply: "Registration cancelled. Text JOIN to start again.",
    };
  if (upper === "YES" && step !== "confirm") return same(promptFor(step, collected));
  if (COMMANDS.has(upper.split(/\s+/)[0])) return same(INCOMPLETE);
  if (step === "confirm") {
    if (upper !== "YES") return same("Reply YES to consent and submit, or NO to cancel.");
    return { action: "complete", step, collected, reply: "" };
  }
  if (step === "start" || step === "name") {
    if (!validName(input))
      return same("Please send a full name (2-100 letters/characters), or NO to cancel.");
    const next = { ...collected, name: input };
    return { action: "save", step: "role", collected: next, reply: promptFor("role", next) };
  }
  if (step === "role") {
    const role = joinRoles[upper];
    if (!role) return same(promptFor("role", collected));
    const next = { ...collected, role };
    return { action: "save", step: "email", collected: next, reply: promptFor("email", next) };
  }
  if (step === "email") {
    if (upper !== "SKIP" && !validEmail(input))
      return same("Please send a valid email address or reply SKIP for phone-only membership.");
    const next = { ...collected, email: upper === "SKIP" ? null : input.toLowerCase() };
    return { action: "save", step: "confirm", collected: next, reply: promptFor("confirm", next) };
  }
  return same("Text JOIN to start registration.");
}
