// Existing email channel, retained alongside the WhatsApp/SMS notification path.
import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { adminClient, dbResult } from "../_shared/db.ts";
import type { Database } from "../../../src/integrations/supabase/types.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Template = "loan_status_changed" | "contribution_reviewed" | "meeting_scheduled";
type EmailData = Record<string, string | number | null | undefined>;
interface EmailNotificationPayload {
  to: string | string[];
  subject: string;
  template: Template;
  data: EmailData;
}

function parsePayload(value: unknown): EmailNotificationPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid email payload");
  const input: Record<string, unknown> = value as Record<string, unknown>;
  const recipients = typeof input.to === "string" ? [input.to] : input.to;
  if (
    !Array.isArray(recipients) ||
    !recipients.length ||
    !recipients.every((to) => typeof to === "string")
  ) {
    throw new Error("An email recipient is required");
  }
  if (typeof input.subject !== "string" || !input.subject.trim())
    throw new Error("Email subject is required");
  const template = input.template;
  if (
    template !== "loan_status_changed" &&
    template !== "contribution_reviewed" &&
    template !== "meeting_scheduled"
  ) {
    throw new Error("Invalid email template");
  }
  const data: EmailData = {};
  if (typeof input.data === "object" && input.data !== null && !Array.isArray(input.data)) {
    for (const [key, item] of Object.entries(input.data)) {
      if (typeof item === "string" || typeof item === "number" || item === null) data[key] = item;
    }
  }
  return { to: recipients, subject: input.subject, template, data };
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function generateHtmlEmail(template: Template, data: EmailData): string {
  const brand = "#0f392b";
  const accent = "#c59a3f";
  let content: string;

  switch (template) {
    case "loan_status_changed": {
      const { memberName, loanAmount, loanType, status, reason, repaymentMonths } = data;
      const color = status === "approved" ? "#16a34a" : status === "rejected" ? "#dc2626" : accent;
      content = `
        <h2 style="color:${brand}">Loan Application Update</h2>
        <p>Dear ${escapeHtml(memberName || "Member")},</p>
        <p>There is an official update on your ${escapeHtml(loanType || "Project")} Loan application:</p>
        <div style="background:#f9fafb;border-left:4px solid ${color};padding:16px;border-radius:4px">
          <p><strong>Loan Amount:</strong> KES ${Number(loanAmount || 0).toLocaleString()}</p>
          <p><strong>Status:</strong> ${escapeHtml(status)}</p>
          <p><strong>Repayment Term:</strong> ${escapeHtml(repaymentMonths || 1)} months</p>
          ${reason ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ""}
        </div>
        <p>View your repayment schedule in the Murage Funds Hub.</p>`;
      break;
    }
    case "contribution_reviewed": {
      const { memberName, amount, status, method, reference, notes } = data;
      const color = status === "confirmed" ? "#16a34a" : "#dc2626";
      content = `
        <h2 style="color:${brand}">Contribution Verification Notice</h2>
        <p>Dear ${escapeHtml(memberName || "Member")}, your contribution has been reviewed:</p>
        <div style="background:#f9fafb;border-left:4px solid ${color};padding:16px;border-radius:4px">
          <p><strong>Amount:</strong> KES ${Number(amount || 0).toLocaleString()}</p>
          <p><strong>Status:</strong> ${escapeHtml(status)}</p>
          <p><strong>Method:</strong> ${escapeHtml(String(method || "M-Pesa").toUpperCase())}</p>
          ${reference ? `<p><strong>Reference:</strong> ${escapeHtml(reference)}</p>` : ""}
          ${notes ? `<p><strong>Treasury Note:</strong> ${escapeHtml(notes)}</p>` : ""}
        </div>
        <p>Thank you for your continued commitment to the Murage Foundation.</p>`;
      break;
    }
    case "meeting_scheduled": {
      const { title, scheduledFor, location, agenda } = data;
      const formattedDate = new Date(String(scheduledFor)).toLocaleString("en-KE", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: "Africa/Nairobi",
      });
      content = `
        <h2 style="color:${brand}">Upcoming Foundation Meeting Notice</h2>
        <p>Dear Foundation Member, a new meeting has been scheduled:</p>
        <div style="background:#f9fafb;border-left:4px solid ${accent};padding:16px;border-radius:4px">
          <h3>${escapeHtml(title)}</h3>
          <p><strong>Date & Time:</strong> ${formattedDate}</p>
          <p><strong>Location:</strong> ${escapeHtml(location || "TBA / Virtual")}</p>
          ${agenda ? `<p><strong>Agenda:</strong><br/>${escapeHtml(agenda).replace(/\n/g, "<br/>")}</p>` : ""}
        </div>`;
      break;
    }
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Murage Foundation Notification</title></head>
    <body style="background:#f3f4f6;padding:24px;margin:0">
      <main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;background:white;border:1px solid #eaeaea;border-radius:8px;color:#2b2f32;line-height:1.6">
        <header style="border-bottom:2px solid ${accent};padding-bottom:12px;font-size:20px;font-weight:bold;color:${brand}">Murage Foundation</header>
        ${content}
        <footer style="border-top:1px solid #eaeaea;margin-top:32px;padding-top:16px;font-size:12px;color:#6b7280">Stewarding every shilling with clarity and care.</footer>
      </main>
    </body></html>`;
}

async function authorizeEmail(request: Request, template: Template): Promise<void> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const publicKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!token || !url || !publicKey) throw new Error("Unauthorized email notification");
  const auth = createClient<Database>(url, publicKey, { auth: { persistSession: false } });
  const {
    data: { user },
    error,
  } = await auth.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized email notification");
  const member = await dbResult(
    "email notification actor",
    adminClient().from("profiles").select("status,is_anonymized").eq("id", user.id).single(),
  );
  if (member?.status !== "approved" || member.is_anonymized)
    throw new Error("Unauthorized email notification");
  const allowed: Database["public"]["Enums"]["app_role"][] =
    template === "contribution_reviewed"
      ? ["admin", "treasurer"]
      : template === "loan_status_changed"
        ? ["admin", "treasurer", "chairman", "board_member"]
        : ["admin", "secretary", "assistant_secretary"];
  const roles = await dbResult(
    "email notification role",
    adminClient()
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .in("role", allowed)
      .limit(1),
  );
  if (!roles?.length) throw new Error("Unauthorized email notification");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { to, subject, template, data } = parsePayload(await request.json());
    await authorizeEmail(request, template);
    const html = generateHtmlEmail(template, data);
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      const sender = Deno.env.get("RESEND_FROM_EMAIL");
      if (!sender) throw new Error("RESEND_FROM_EMAIL must be a verified sender");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: sender,
          to: Array.isArray(to) ? to : [to],
          subject,
          html,
        }),
      });
      if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
    } else {
      // No recipient addresses, financial details or setup links in Edge logs.
      console.info("[send-email] RESEND_API_KEY not configured; email delivery skipped");
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[send-email] delivery failed", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Email error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
