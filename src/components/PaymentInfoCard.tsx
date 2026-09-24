import { Link } from "@tanstack/react-router";
import { CreditCard, Smartphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { payment } from "@/lib/foundation";

export function PaymentInfoCard() {
  return (
    <Card className="overflow-hidden border-gold/40 bg-gradient-to-br from-gold/10 via-card to-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 font-serif text-lg text-primary">
          <CreditCard className="h-5 w-5 text-gold" aria-hidden="true" /> How To Pay Contributions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Bank", value: payment.bank },
            { label: "Method", value: payment.method },
            { label: "Paybill", value: payment.paybill },
            { label: "Account", value: payment.account },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-1 font-semibold text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="flex items-start gap-2 border-t border-gold/30 pt-3 text-sm text-muted-foreground">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            After paying, submit your M-Pesa reference on My Contributions or text{" "}
            <code className="rounded bg-muted px-1 text-foreground">
              DEPOSIT {"{amount} {ref}"}
            </code>{" "}
            to our WhatsApp/SMS bot.{" "}
            <Link to="/bot-help" className="font-medium text-primary underline underline-offset-2">
              Bot guide
            </Link>
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
