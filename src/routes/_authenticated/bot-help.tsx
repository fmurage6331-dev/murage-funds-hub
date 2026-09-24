import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, CreditCard, HelpCircle, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FOUNDATION } from "@/lib/foundation";

export const Route = createFileRoute("/_authenticated/bot-help")({ component: BotHelpPage });

const commands = [
  { command: "JOIN", example: "JOIN", purpose: "Apply for membership (email optional)" },
  { command: "BAL", example: "BAL", purpose: "See confirmed contributions and last payment" },
  { command: "LOANS", example: "LOANS", purpose: "View approved loan totals, repayments and risk" },
  {
    command: "DEPOSIT",
    example: "DEPOSIT 5000 QWE123456",
    purpose: "Submit your M-Pesa reference for treasury review",
  },
  {
    command: "SCHEDULE",
    example: "SCHEDULE",
    purpose: "See your next five repayment installments",
  },
  { command: "HELP", example: "HELP", purpose: "View the bot menu" },
  { command: "STOP", example: "STOP", purpose: "Opt out of messages (JOIN to opt back in)" },
  { command: "PENDING", example: "PENDING", purpose: "Officer only: list pending deposits" },
  { command: "CONFIRM", example: "CONFIRM QWE123456", purpose: "Officer only: confirm a deposit" },
] as const;

const registrationSteps = [
  "Text JOIN to the Foundation's registered WhatsApp bot number or SMS shortcode.",
  "Reply with your full name.",
  "Choose a role: 1 Member, 2 Board Member, 3 Secretary or 4 Assistant Secretary.",
  "Enter your email address for web access, or reply SKIP for phone-only membership (bot access only).",
  "Review the summary and reply YES to consent and submit, or NO to cancel.",
  "Wait for an admin to approve your request; you'll receive an SMS or WhatsApp reply.",
] as const;

const paymentSteps = [
  "Open M-Pesa on your phone.",
  "Select Lipa na M-Pesa.",
  "Select Pay Bill.",
  `Enter Business No: ${FOUNDATION.paybill}.`,
  `Enter Account No: ${FOUNDATION.account}.`,
  "Enter the amount.",
  "Enter your M-Pesa PIN.",
  "Note the reference from your confirmation SMS.",
  "Text DEPOSIT {amount} {reference} to the bot, e.g. DEPOSIT 5000 QWE123456. A treasurer will verify the payment.",
] as const;

function BotHelpPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-serif text-2xl font-semibold text-primary">
          <MessageCircle className="h-6 w-6" /> WhatsApp & SMS Bot Guide
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Access your Foundation records from your phone. Ask the admin for the registered bot
          number or SMS shortcode before sending a command.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <BookOpen className="h-5 w-5 text-primary" /> How to Register via Bot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
            {registrationSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">
            Sessions expire after 30 minutes. Reply YES to resume an interrupted registration, or NO
            to cancel it. Donors cannot register through the bot.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Available Commands</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Command</TableHead>
                <TableHead>Example</TableHead>
                <TableHead>What it does</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commands.map((item) => (
                <TableRow key={item.command}>
                  <TableCell>
                    <Badge variant="secondary">{item.command}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {item.example}
                  </TableCell>
                  <TableCell className="text-sm">{item.purpose}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <CreditCard className="h-5 w-5 text-primary" /> How to Pay
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-lg border border-gold/30 bg-gold/5 p-3 font-medium">
            {FOUNDATION.bank} · M-Pesa Paybill{" "}
            <span className="font-mono">{FOUNDATION.paybill}</span> · Account{" "}
            <span className="font-mono">{FOUNDATION.account}</span>
          </div>
          <ol className="list-decimal space-y-2 pl-5 leading-relaxed">
            {paymentSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-muted-foreground">
            Submitting a reference does not confirm a payment; only a treasurer or admin can confirm
            it. Do not share your M-Pesa PIN with anyone.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <HelpCircle className="h-5 w-5 text-primary" /> Need Help?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Contact the Foundation admin at {FOUNDATION.adminPhone}:{" "}
            <a
              href={`https://wa.me/${FOUNDATION.adminPhone.replace("+", "")}`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-primary underline"
            >
              WhatsApp
            </a>{" "}
            or{" "}
            <a
              href={`tel:${FOUNDATION.adminPhone}`}
              className="font-semibold text-primary underline"
            >
              call
            </a>
            .
          </p>
          <p>
            Web app:{" "}
            <a href={FOUNDATION.website} className="text-primary underline">
              murage-funds-hub.vercel.app
            </a>
          </p>
          <p className="text-xs text-muted-foreground">{FOUNDATION.registration}.</p>
        </CardContent>
      </Card>
    </div>
  );
}
