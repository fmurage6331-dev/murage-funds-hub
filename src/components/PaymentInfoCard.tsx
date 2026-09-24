import { Link } from "@tanstack/react-router";
import { CreditCard, MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FOUNDATION } from "@/lib/foundation";

type PaymentInfoCardProps = { canSubmitHere?: boolean };

export function PaymentInfoCard({ canSubmitHere = false }: PaymentInfoCardProps) {
  return (
    <Card className="border-gold/40 bg-gold/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 font-serif text-lg text-primary">
          <CreditCard className="h-5 w-5 text-gold" /> How To Pay Contributions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm sm:max-w-sm">
          <dt className="text-muted-foreground">Bank</dt>
          <dd className="font-medium">{FOUNDATION.bank}</dd>
          <dt className="text-muted-foreground">Method</dt>
          <dd className="font-medium">M-Pesa Paybill</dd>
          <dt className="text-muted-foreground">Paybill</dt>
          <dd className="font-mono text-lg font-semibold">{FOUNDATION.paybill}</dd>
          <dt className="text-muted-foreground">Account</dt>
          <dd className="font-mono text-lg font-semibold">{FOUNDATION.account}</dd>
        </dl>
        <div className="flex items-start gap-2 border-t border-border/60 pt-3 text-sm text-muted-foreground">
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            After paying, submit your M-Pesa reference{" "}
            {canSubmitHere ? (
              "below"
            ) : (
              <Link to="/my-contributions" className="font-medium text-primary underline">
                on My Contributions
              </Link>
            )}{" "}
            or text{" "}
            <code className="font-semibold text-foreground">
              DEPOSIT {"{amount}"} {"{ref}"}
            </code>{" "}
            to our WhatsApp/SMS bot.{" "}
            <Link to="/bot-help" className="font-medium text-primary underline">
              Bot guide
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
