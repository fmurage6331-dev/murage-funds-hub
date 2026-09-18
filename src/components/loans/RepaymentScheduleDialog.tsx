import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  AlertTriangle,
  PlusCircle,
  CreditCard,
  Landmark,
} from "lucide-react";
import { toast } from "sonner";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

interface RepaymentScheduleDialogProps {
  loan: {
    id: string;
    amount: number;
    repayment_months: number;
    status: string;
    created_at: string;
    decision_at?: string | null;
    purpose?: string;
  };
  canRecordPayment?: boolean;
  memberEmail?: string;
  triggerButton?: React.ReactNode;
}

export function RepaymentScheduleDialog({
  loan,
  canRecordPayment = false,
  memberEmail,
  triggerButton,
}: RepaymentScheduleDialogProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  const { data: repayments = [], isLoading } = useQuery({
    queryKey: ["loan_repayments", loan.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loan_repayments")
        .select("*")
        .eq("loan_id", loan.id)
        .order("installment_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const totalDue = Number(loan.amount);
  const totalPaid = repayments.reduce((sum, r) => sum + Number(r.amount_paid || 0), 0);
  const outstandingBalance = Math.max(0, totalDue - totalPaid);
  const overdueCount = repayments.filter((r) => r.status === "overdue").length;

  // Form for recording payment
  const firstUnpaid = repayments.find((r) => r.status !== "paid");
  const [selectedInstallmentId, setSelectedInstallmentId] = useState<string>("");
  const [amountToPay, setAmountToPay] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("mpesa");
  const [reference, setReference] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState<string>("");

  const selectedInstallment = repayments.find((r) => r.id === selectedInstallmentId) || firstUnpaid;

  // Action: Generate schedule if missing
  const generateSchedule = useMutation({
    mutationFn: async () => {
      const months = Math.max(1, loan.repayment_months);
      const monthlyDue = Math.round((totalDue / months) * 100) / 100;
      const startDate = new Date(loan.decision_at || loan.created_at || new Date());

      const records = [];
      for (let i = 1; i <= months; i++) {
        const d = new Date(startDate);
        d.setMonth(d.getMonth() + i);
        const due = i === months ? totalDue - monthlyDue * (months - 1) : monthlyDue;
        records.push({
          loan_id: loan.id,
          installment_number: i,
          amount_due: due,
          due_date: d.toISOString().slice(0, 10),
          amount_paid: 0,
          status: "pending" as const,
        });
      }

      const { error } = await supabase.from("loan_repayments").insert(records);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Repayment schedule created");
      qc.invalidateQueries({ queryKey: ["loan_repayments", loan.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Action: Record payment
  const recordPayment = useMutation({
    mutationFn: async () => {
      if (!selectedInstallment) throw new Error("No installment selected");
      const numAmount = Number(amountToPay);
      if (!numAmount || numAmount <= 0) throw new Error("Please enter a valid payment amount");

      const newTotalPaid = Number(selectedInstallment.amount_paid || 0) + numAmount;
      const newStatus =
        newTotalPaid >= Number(selectedInstallment.amount_due)
          ? "paid"
          : new Date(selectedInstallment.due_date) < new Date()
            ? "overdue"
            : "partial";

      const { data: authData } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("loan_repayments")
        .update({
          amount_paid: newTotalPaid,
          paid_at: new Date(paymentDate).toISOString(),
          status: newStatus,
          payment_method: paymentMethod,
          reference: reference || null,
          recorded_by: authData.user?.id || null,
          notes: notes || null,
        })
        .eq("id", selectedInstallment.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded successfully");
      setShowPaymentForm(false);
      setAmountToPay("");
      setReference("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["loan_repayments", loan.id] });
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["my-loans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "paid":
        return (
          <Badge className="bg-emerald-600 text-white gap-1 text-[11px]">
            <CheckCircle2 className="h-3 w-3" /> Paid
          </Badge>
        );
      case "partial":
        return (
          <Badge className="bg-amber-600 text-white gap-1 text-[11px]">
            <Clock className="h-3 w-3" /> Partial
          </Badge>
        );
      case "overdue":
        return (
          <Badge className="bg-rose-600 text-white gap-1 text-[11px]">
            <AlertTriangle className="h-3 w-3" /> Overdue
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground gap-1 text-[11px]">
            <CalendarDays className="h-3 w-3" /> Pending
          </Badge>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
            <CalendarDays className="h-3.5 w-3.5" /> Schedule
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Landmark className="h-5 w-5 text-primary" />
            Loan Repayment Schedule
            {memberEmail && (
              <span className="text-sm font-normal text-muted-foreground">({memberEmail})</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Financial Highlights */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-2">
          <div className="rounded-lg border bg-card p-3 text-center">
            <span className="text-xs text-muted-foreground">Loan Principal</span>
            <div className="text-lg font-semibold text-primary">{fmt(totalDue)}</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <span className="text-xs text-muted-foreground">Total Repaid</span>
            <div className="text-lg font-semibold text-emerald-600">{fmt(totalPaid)}</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <span className="text-xs text-muted-foreground">Outstanding Balance</span>
            <div className="text-lg font-semibold text-rose-600">{fmt(outstandingBalance)}</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <span className="text-xs text-muted-foreground">Overdue Installments</span>
            <div
              className={`text-lg font-semibold ${overdueCount > 0 ? "text-rose-600" : "text-muted-foreground"}`}
            >
              {overdueCount}
            </div>
          </div>
        </div>

        {/* Action button row for treasurers/admins */}
        {canRecordPayment && (
          <div className="flex items-center justify-between py-2 border-y">
            <div className="text-xs text-muted-foreground">
              {repayments.length === 0
                ? "No schedule generated yet for this loan."
                : `${repayments.length} scheduled installments (${loan.repayment_months} months)`}
            </div>
            <div className="flex gap-2">
              {repayments.length === 0 && (
                <Button
                  size="sm"
                  onClick={() => generateSchedule.mutate()}
                  disabled={generateSchedule.isPending}
                  className="gap-1 text-xs"
                >
                  <PlusCircle className="h-3.5 w-3.5" /> Generate Schedule
                </Button>
              )}
              {repayments.length > 0 && outstandingBalance > 0 && (
                <Button
                  size="sm"
                  variant={showPaymentForm ? "secondary" : "default"}
                  onClick={() => {
                    setShowPaymentForm(!showPaymentForm);
                    if (firstUnpaid) {
                      setSelectedInstallmentId(firstUnpaid.id);
                      setAmountToPay(
                        String(Number(firstUnpaid.amount_due) - Number(firstUnpaid.amount_paid)),
                      );
                    }
                  }}
                  className="gap-1 text-xs"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  {showPaymentForm ? "Hide Payment Form" : "Record Payment Received"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Payment Recording Form */}
        {showPaymentForm && canRecordPayment && (
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
            <div className="font-semibold text-sm flex items-center gap-1.5 text-primary">
              <CreditCard className="h-4 w-4" /> Record Repayment Received
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <Label className="text-xs">Select Installment</Label>
                <Select
                  value={selectedInstallmentId || (firstUnpaid ? firstUnpaid.id : "")}
                  onValueChange={(val) => {
                    setSelectedInstallmentId(val);
                    const inst = repayments.find((r) => r.id === val);
                    if (inst) {
                      setAmountToPay(
                        String(Math.max(0, Number(inst.amount_due) - Number(inst.amount_paid))),
                      );
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Choose installment" />
                  </SelectTrigger>
                  <SelectContent>
                    {repayments.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        Installment #{r.installment_number} (Due: {r.due_date} -{" "}
                        {fmt(Number(r.amount_due))})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Amount Received (KES)</Label>
                <Input
                  type="number"
                  min="1"
                  step="0.01"
                  className="h-8 text-xs"
                  value={amountToPay}
                  onChange={(e) => setAmountToPay(e.target.value)}
                  placeholder="Enter amount"
                />
              </div>

              <div>
                <Label className="text-xs">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mpesa">M-Pesa</SelectItem>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Reference / Confirmation Code</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="e.g. QX910A2B4"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs">Payment Date</Label>
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs">Notes (Optional)</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="Notes on installment"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowPaymentForm(false)}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => recordPayment.mutate()}
                disabled={recordPayment.isPending}
                className="h-8 text-xs"
              >
                {recordPayment.isPending ? "Recording..." : "Save Payment"}
              </Button>
            </div>
          </div>
        )}

        {/* Installment Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Amount Due</TableHead>
                <TableHead>Amount Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment Info</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground text-xs">
                    Loading repayment schedule...
                  </TableCell>
                </TableRow>
              ) : repayments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground text-xs">
                    No repayment schedule created yet. It will automatically generate upon loan
                    approval.
                  </TableCell>
                </TableRow>
              ) : (
                repayments.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold text-xs">#{r.installment_number}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {new Date(r.due_date).toLocaleDateString("en-KE", { dateStyle: "medium" })}
                    </TableCell>
                    <TableCell className="text-xs font-semibold">
                      {fmt(Number(r.amount_due))}
                    </TableCell>
                    <TableCell className="text-xs font-semibold text-emerald-600">
                      {fmt(Number(r.amount_paid))}
                    </TableCell>
                    <TableCell>{getStatusBadge(r.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.paid_at ? (
                        <div>
                          <span className="font-medium text-foreground">
                            {r.payment_method?.toUpperCase()}
                          </span>
                          {r.reference && <span className="ml-1 font-mono">({r.reference})</span>}
                          <div className="text-[10px]">
                            {new Date(r.paid_at).toLocaleDateString("en-KE", {
                              dateStyle: "short",
                            })}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
