import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreditCard, HelpCircle, MessageCircle, Smartphone } from "lucide-react";
import { foundation, payment } from "@/lib/foundation";

export const Route = createFileRoute("/_authenticated/bot-help")({ component: BotHelpPage });

const commands = [
  {
    name: "JOIN",
    example: "JOIN",
    use: "Apply to join the foundation by answering a few questions.",
  },
  { name: "BAL", example: "BAL", use: "Check confirmed contributions and your latest payment." },
  {
    name: "LOANS",
    example: "LOANS",
    use: "See your latest approved loan, progress and risk status.",
  },
  {
    name: "DEPOSIT",
    example: "DEPOSIT 5000 QWE123456",
    use: "Submit a payment reference for treasurer review.",
  },
  { name: "SCHEDULE", example: "SCHEDULE", use: "See your next five unpaid loan installments." },
  {
    name: "PENDING",
    example: "PENDING",
    use: "List deposits waiting for review (admin/treasurer only).",
  },
  {
    name: "CONFIRM",
    example: "CONFIRM QWE123456",
    use: "Confirm a pending deposit (admin/treasurer only).",
  },
  { name: "HELP", example: "HELP", use: "Show the command menu and payment details." },
  { name: "STOP", example: "STOP", use: "Unsubscribe from Foundation messages." },
] as const;

const paymentSteps = [
  "Open M-Pesa on your phone.",
  "Select Lipa na M-Pesa.",
  "Select Pay Bill.",
  `Enter Business No: ${payment.paybill}.`,
  `Enter Account No: ${payment.account}.`,
  "Enter the amount in KES.",
  "Enter your M-Pesa PIN.",
  "Note the confirmation SMS transaction reference.",
  "Text DEPOSIT {amount} {reference} to the bot, e.g. DEPOSIT 5000 QWE123456.",
];

function BotHelpPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Badge variant="secondary" className="mb-2 gap-1">
          <MessageCircle className="h-3 w-3" /> Member help
        </Badge>
        <h1 className="font-serif text-3xl font-semibold text-primary">WhatsApp & SMS Bot Guide</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your Murage Foundation membership and contributions wherever you are, with or
          without a web account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif">
            <Smartphone className="h-5 w-5 text-primary" /> 1. How to Register via Bot
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Ask the administrator for the official Foundation WhatsApp bot number or SMS shortcode.
            Then:
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Send <strong>JOIN</strong> from your own phone.
            </li>
            <li>Reply with your full name.</li>
            <li>Choose 1 Member, 2 Board member, 3 Secretary or 4 Assistant secretary.</li>
            <li>
              Send your email for web and bot access, or <strong>SKIP</strong> for a phone-only
              membership.
            </li>
            <li>
              Check your summary and reply <strong>YES</strong> to confirm and consent to membership
              processing and messages, or NO to cancel.
            </li>
            <li>
              Wait for an administrator to approve your application. Email members receive a
              one-time password setup link; phone-only members can use bot commands as soon as they
              are approved.
            </li>
          </ol>
          <p className="text-muted-foreground">
            Sessions expire after 30 minutes. Text STOP to unsubscribe; text JOIN and confirm YES to
            re-subscribe later.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif">2. Available Commands</CardTitle>
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
              {commands.map((command) => (
                <TableRow key={command.name}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {command.name}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {command.example}
                  </TableCell>
                  <TableCell>{command.use}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-gold/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif">
            <CreditCard className="h-5 w-5 text-gold" /> 3. How to Pay
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-[1fr_1.5fr]">
          <div className="rounded-lg bg-gold/10 p-4 text-sm">
            <h3 className="font-semibold">{payment.bank}</h3>
            <p className="mt-2">{payment.method}</p>
            <p className="mt-3">
              Business / Paybill No:{" "}
              <strong className="font-mono text-lg">{payment.paybill}</strong>
            </p>
            <p>
              Account No: <strong className="font-mono text-lg">{payment.account}</strong>
            </p>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {paymentSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif">
            <HelpCircle className="h-5 w-5 text-primary" /> 4. Need Help?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Call or WhatsApp the administrator:{" "}
            <a
              href={`tel:${foundation.adminPhone}`}
              className="font-semibold text-primary underline"
            >
              {foundation.adminPhone}
            </a>
          </p>
          <p>
            Web app:{" "}
            <a href={foundation.webUrl} className="text-primary underline">
              {foundation.webUrl}
            </a>
          </p>
          <p className="text-muted-foreground">
            {foundation.name} · {foundation.registrationStatus}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
