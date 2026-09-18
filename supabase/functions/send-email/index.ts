// Supabase Edge Function: send-email
// Triggered on:
// 1. Loan status changes (submitted -> forwarded -> approved / rejected)
// 2. Contribution status changes (pending -> confirmed / rejected)
// 3. New meeting scheduled

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailNotificationPayload {
  to: string | string[];
  subject: string;
  template: "loan_status_changed" | "contribution_reviewed" | "meeting_scheduled";
  data: Record<string, any>;
}

function generateHtmlEmail(template: string, data: Record<string, any>): string {
  const brandColor = "#0f392b"; // deep primary green
  const accentColor = "#c59a3f"; // gold
  const baseStyles = `
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #2b2f32;
    line-height: 1.6;
    max-width: 600px;
    margin: 0 auto;
    padding: 24px;
    background-color: #ffffff;
    border: 1px solid #eaeaea;
    border-radius: 8px;
  `;

  let contentHtml = "";

  switch (template) {
    case "loan_status_changed": {
      const { memberName, loanAmount, loanType, status, reason, repaymentMonths } = data;
      const statusBadgeColor = status === "approved" ? "#16a34a" : status === "rejected" ? "#dc2626" : "#c59a3f";

      contentHtml = `
        <h2 style="color: ${brandColor}; margin-top: 0;">Loan Application Update</h2>
        <p>Dear ${memberName || "Member"},</p>
        <p>There is an official update on your <strong>${loanType || "Project"} Loan</strong> application with the Murage Foundation:</p>
        <div style="background-color: #f9fafb; border-left: 4px solid ${statusBadgeColor}; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0 0 8px 0;"><strong>Loan Amount:</strong> KES ${Number(loanAmount || 0).toLocaleString()}</p>
          <p style="margin: 0 0 8px 0;"><strong>Status:</strong> <span style="color: ${statusBadgeColor}; font-weight: bold; text-transform: uppercase;">${status}</span></p>
          <p style="margin: 0 0 8px 0;"><strong>Repayment Term:</strong> ${repaymentMonths || 1} Months</p>
          ${reason ? `<p style="margin: 0; color: #6b7280;"><strong>Note / Reason:</strong> ${reason}</p>` : ""}
        </div>
        <p>You can view your complete loan status and repayment schedule by logging into the Murage Funds Hub.</p>
      `;
      break;
    }

    case "contribution_reviewed": {
      const { memberName, amount, status, method, reference, notes } = data;
      const statusColor = status === "confirmed" ? "#16a34a" : "#dc2626";

      contentHtml = `
        <h2 style="color: ${brandColor}; margin-top: 0;">Contribution Verification Notice</h2>
        <p>Dear ${memberName || "Member"},</p>
        <p>Your recorded contribution has been reviewed by the Foundation Treasury:</p>
        <div style="background-color: #f9fafb; border-left: 4px solid ${statusColor}; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0 0 8px 0;"><strong>Amount:</strong> KES ${Number(amount || 0).toLocaleString()}</p>
          <p style="margin: 0 0 8px 0;"><strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold; text-transform: uppercase;">${status}</span></p>
          <p style="margin: 0 0 8px 0;"><strong>Method:</strong> ${(method || "M-Pesa").toUpperCase()}</p>
          ${reference ? `<p style="margin: 0 0 8px 0;"><strong>Reference:</strong> ${reference}</p>` : ""}
          ${notes ? `<p style="margin: 0; color: #6b7280;"><strong>Treasury Note:</strong> ${notes}</p>` : ""}
        </div>
        <p>Thank you for your active stewardship and continued commitment to the Murage Foundation.</p>
      `;
      break;
    }

    case "meeting_scheduled": {
      const { title, scheduledFor, location, agenda } = data;
      const formattedDate = new Date(scheduledFor).toLocaleString("en-KE", {
        dateStyle: "full",
        timeStyle: "short",
      });

      contentHtml = `
        <h2 style="color: ${brandColor}; margin-top: 0;">Upcoming Foundation Meeting Notice</h2>
        <p>Dear Foundation Member,</p>
        <p>A new official meeting has been scheduled by the Secretariat:</p>
        <div style="background-color: #f9fafb; border-left: 4px solid ${accentColor}; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <h3 style="margin: 0 0 10px 0; color: ${brandColor};">${title}</h3>
          <p style="margin: 0 0 8px 0;"><strong>Date & Time:</strong> ${formattedDate}</p>
          <p style="margin: 0 0 8px 0;"><strong>Location / Venue:</strong> ${location || "TBA / Virtual"}</p>
          ${agenda ? `<p style="margin: 0; color: #374151;"><strong>Agenda:</strong><br/>${agenda.replace(/\n/g, "<br/>")}</p>` : ""}
        </div>
        <p>Your attendance and prompt participation are highly appreciated.</p>
      `;
      break;
    }

    default:
      contentHtml = `<p>${JSON.stringify(data)}</p>`;
  }

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Murage Foundation Notification</title>
      </head>
      <body style="background-color: #f3f4f6; padding: 24px 0; margin: 0;">
        <div style="${baseStyles}">
          <div style="border-bottom: 2px solid ${accentColor}; padding-bottom: 12px; margin-bottom: 20px; display: flex; align-items: center;">
            <div style="font-size: 20px; font-weight: bold; color: ${brandColor}; font-family: serif;">
              Murage Foundation
            </div>
            <div style="font-size: 11px; color: #6b7280; margin-left: auto; text-transform: uppercase; letter-spacing: 1px;">
              Official Notice
            </div>
          </div>
          ${contentHtml}
          <div style="border-top: 1px solid #eaeaea; margin-top: 32px; padding-top: 16px; font-size: 12px; color: #9ca3af; text-align: center;">
            Murage Foundation Financial & Governance Portal • Stewarding every shilling with clarity and care.
          </div>
        </div>
      </body>
    </html>
  `;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: EmailNotificationPayload = await req.json();
    const { to, subject, template, data } = payload;

    if (!to || !subject || !template) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, subject, template" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const html = generateHtmlEmail(template, data || {});

    // In production with Resend API key:
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    let providerResult = null;

    if (resendApiKey) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Murage Foundation <notifications@murage.internal>",
          to: Array.isArray(to) ? to : [to],
          subject,
          html,
        }),
      });
      providerResult = await res.json();
    } else {
      // Development / sandbox logging fallback
      console.log(`[Edge Function: send-email] Simulated email dispatch:`);
      console.log(`  To: ${JSON.stringify(to)}`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Template: ${template}`);
      providerResult = { simulated: true, delivered_to: to, timestamp: new Date().toISOString() };
    }

    return new Response(
      JSON.stringify({ success: true, message: "Notification processed", result: providerResult }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[send-email error]", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
