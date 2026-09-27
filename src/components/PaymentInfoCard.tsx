import { CreditCard, Smartphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function PaymentInfoCard() {
  return (
    <Card className="border-emerald-200 bg-emerald-50 text-emerald-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          How To Make Contributions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt>Bank:</dt>
          <dd>KCB Bank Kenya</dd>
          <dt>Method:</dt>
          <dd>M-Pesa Paybill</dd>
          <dt>Paybill:</dt>
          <dd>
            <Badge className="bg-emerald-700 text-white">522522</Badge>
          </dd>
          <dt>Account:</dt>
          <dd>
            <Badge className="bg-emerald-700 text-white">7989164</Badge>
          </dd>
        </dl>
        <h3 className="flex items-center gap-2 font-semibold">
          <Smartphone className="h-4 w-4" />
          Steps
        </h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open M-Pesa on your phone</li>
          <li>Select Lipa na M-Pesa</li>
          <li>Select Pay Bill</li>
          <li>
            Business No: <strong>522522</strong>
          </li>
          <li>
            Account No: <strong>7989164</strong>
          </li>
          <li>Enter amount and PIN</li>
          <li>Note the M-Pesa reference code</li>
          <li>
            Submit here or text <code className="font-semibold">{"DEPOSIT {amount} {ref}"}</code> to
            our WhatsApp/SMS bot
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}
