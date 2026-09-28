import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  Landmark,
  Loader2,
  PlusCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { notifyLoanPaymentSubmitted } from "@/lib/notifications";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

type Repayment = Tables<"loan_repayments">;
type PaymentMethod = "mpesa" | "bank_transfer" | "cash";

interface RepaymentScheduleDialogProps {
  loan: {
    id: string;
    amount: number;
    repayment_months: number;
    status: string;
    created_at: string;
    decision_at?: string | null;
    purpose?: string;
    member_id?: string;
  };
  /** Treasurer/admin mode: show the existing officer recording controls. */
  canRecordPayment?: boolean;
  /** Member mode: allow the logged-in member to submit a payment for review. */
  canSubmitPayment?: boolean;
  /** Used by the dashboard shortcut to open the form for a specific installment. */
  defaultInstallmentId?: string;
  openPaymentFormOnOpen?: boolean;
  memberEmail?: string;
  memberName?: string;
  triggerButton?: ReactNode;
}

function localDateToday(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function isSettled(repayment: Repayment): boolean {
  return repayment.payment_status === "confirmed" || repayment.status === "paid";
}

function canMemberSubmit(repayment: Repayment): boolean {
  return (
    (repayment.status === "pending" || repayment.status === "overdue") &&
    (repayment.payment_status === "not_paid" || repayment.payment_status === "rejected")
  );
}

function methodLabel(method: string | null): string {
  if (method === "bank_transfer") return "Bank transfer";
  if (method === "mpesa") return "M-Pesa";
  if (method === "cash") return "Cash";
  return method || "—";
}

export function RepaymentScheduleDialog({
  loan,
  canRecordPayment = false,
  canSubmitPayment = false,
  defaultInstallmentId,
  openPaymentFormOnOpen = false,
  memberEmail,
  memberName,
  triggerButton,
}: RepaymentScheduleDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [autoOpenedPayment, setAutoOpenedPayment] = useState(false);
  const today = localDateToday();

  const [showOfficerPaymentForm, setShowOfficerPaymentForm] = useState(false);
  const [selectedInstallmentId, setSelectedInstallmentId] = useState("");
  const [amountToPay, setAmountToPay] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("mpesa");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [notes, setNotes] = useState("");

  const { data: repayments = [], isLoading } = useQuery<Repayment[]>({
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

  const totalLoan = Number(loan.amount);
  const totalPaid = useMemo(
    () =>
      repayments
        .filter(
          (repayment) => repayment.payment_status === "confirmed" || repayment.status === "paid",
        )
        .reduce((sum, repayment) => sum + Number(repayment.amount_paid || 0), 0),
    [repayments],
  );
  const outstandingBalance = Math.max(0, totalLoan - totalPaid);
  const nextDue = repayments.find((repayment) => !isSettled(repayment));
  const overdueCount = repayments.filter(
    (repayment) => repayment.status === "overdue" && !isSettled(repayment),
  ).length;
  const firstUnpaid = repayments.find((repayment) => !isSettled(repayment));
  const selectedInstallment =
    repayments.find((repayment) => repayment.id === selectedInstallmentId) ?? firstUnpaid;

  const prepareMemberPayment = useCallback((repayment: Repayment) => {
    setSelectedInstallmentId(repayment.id);
    setAmountToPay(String(Number(repayment.amount_due)));
    setPaymentMethod("mpesa");
    setReference("");
    setPaymentDate(localDateToday());
    setNotes("");
  }, []);

  useEffect(() => {
    if (!open) {
      setAutoOpenedPayment(false);
      return;
    }

    if (
      !canSubmitPayment ||
      !openPaymentFormOnOpen ||
      autoOpenedPayment ||
      repayments.length === 0
    ) {
      return;
    }

    const requested = defaultInstallmentId
      ? repayments.find((repayment) => repayment.id === defaultInstallmentId)
      : undefined;
    const repayment =
      requested && canMemberSubmit(requested) ? requested : repayments.find(canMemberSubmit);

    if (repayment) {
      prepareMemberPayment(repayment);
      setPaymentDialogOpen(true);
    }
    setAutoOpenedPayment(true);
  }, [
    autoOpenedPayment,
    canSubmitPayment,
    defaultInstallmentId,
    open,
    openPaymentFormOnOpen,
    prepareMemberPayment,
    repayments,
  ]);

  const generateSchedule = useMutation({
    mutationFn: async () => {
      try {
        const months = Math.max(1, loan.repayment_months);
        const monthlyDue = Math.round((totalLoan / months) * 100) / 100;
        const startDate = new Date(loan.decision_at || loan.created_at || new Date());
        const records: Array<{
          loan_id: string;
          installment_number: number;
          amount_due: number;
          due_date: string;
          amount_paid: number;
          status: "pending";
        }> = [];

        for (let i = 1; i <= months; i += 1) {
          const dueDate = new Date(startDate);
          dueDate.setMonth(dueDate.getMonth() + i);
          const amountDue = i === months ? totalLoan - monthlyDue * (months - 1) : monthlyDue;
          records.push({
            loan_id: loan.id,
            installment_number: i,
            amount_due: amountDue,
            due_date: dueDate.toISOString().slice(0, 10),
            amount_paid: 0,
            status: "pending",
          });
        }

        const { error } = await supabase.from("loan_repayments").insert(records);
        if (error) throw error;
      } catch (error) {
        throw error instanceof Error
          ? error
          : new Error("Could not create the repayment schedule.");
      }
    },
    onSuccess: () => {
      toast.success("Repayment schedule created");
      void queryClient.invalidateQueries({ queryKey: ["loan_repayments", loan.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submitPayment = useMutation({
    mutationFn: async () => {
      try {
        if (!selectedInstallment || !canMemberSubmit(selectedInstallment)) {
          throw new Error("Select an installment that is ready for payment.");
        }

        const amount = Number(amountToPay);
        if (!Number.isFinite(amount) || amount < 1) {
          throw new Error("Amount paid must be at least KES 1.");
        }
        if (amount > Number(selectedInstallment.amount_due)) {
          throw new Error("Amount paid cannot exceed the installment amount due.");
        }
        if (!reference.trim()) throw new Error("M-Pesa reference is required.");
        if (!paymentDate) throw new Error("Payment date is required.");
        if (paymentDate > today) throw new Error("Payment date cannot be in the future.");

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) throw new Error("Please sign in again before logging a payment.");

        const submittedAt = new Date().toISOString();
        const { error } = await supabase
          .from("loan_repayments")
          .update({
            payment_status: "pending_confirmation",
            payment_reference: reference.trim(),
            payment_submitted_by: user.id,
            payment_submitted_at: submittedAt,
            member_notes: notes.trim() || null,
            payment_method: paymentMethod,
          })
          .eq("id", selectedInstallment.id);
        if (error) throw error;

        return {
          amount,
          installmentNumber: selectedInstallment.installment_number,
          reference: reference.trim(),
          submittedAt,
        };
      } catch (error) {
        throw error instanceof Error ? error : new Error("Could not log this payment.");
      }
    },
    onSuccess: (payment) => {
      toast.success("Payment logged! Treasurer will confirm within 24 hours.");
      setPaymentDialogOpen(false);
      setReference("");
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["loan_repayments", loan.id] });
      void queryClient.invalidateQueries({ queryKey: ["loan_repayments", "pending-review"] });
      void queryClient.invalidateQueries({ queryKey: ["loans"] });
      void queryClient.invalidateQueries({ queryKey: ["my-loans"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-loan-payments"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-loan-payments-count"] });

      void notifyLoanPaymentSubmitted({
        memberName: memberName ?? memberEmail ?? "Member",
        amount: payment.amount,
        reference: payment.reference,
        installmentNumber: payment.installmentNumber,
        loanId: loan.id,
        submittedAt: payment.submittedAt,
      }).catch((error: unknown) => {
        console.warn("Failed sending loan payment submission notification", error);
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const recordPayment = useMutation({
    mutationFn: async () => {
      try {
        if (!selectedInstallment) throw new Error("No installment selected.");
        const amount = Number(amountToPay);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("Please enter a valid payment amount.");
        }

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) throw new Error("Please sign in again before recording a payment.");

        const status = amount >= Number(selectedInstallment.amount_due) ? "paid" : "partial";
        const confirmedAt = new Date(paymentDate).toISOString();
        const { error } = await supabase
          .from("loan_repayments")
          .update({
            amount_paid: amount,
            paid_at: confirmedAt,
            status,
            payment_status: "confirmed",
            payment_method: paymentMethod,
            reference: reference.trim() || null,
            payment_reference: reference.trim() || null,
            recorded_by: user.id,
            payment_confirmed_by: user.id,
            payment_confirmed_at: new Date().toISOString(),
            notes: notes.trim() || null,
          })
          .eq("id", selectedInstallment.id);
        if (error) throw error;
      } catch (error) {
        throw error instanceof Error ? error : new Error("Could not record this payment.");
      }
    },
    onSuccess: () => {
      toast.success("Payment recorded successfully");
      setShowOfficerPaymentForm(false);
      setAmountToPay("");
      setReference("");
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["loan_repayments", loan.id] });
      void queryClient.invalidateQueries({ queryKey: ["loans"] });
      void queryClient.invalidateQueries({ queryKey: ["my-loans"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const statusIndicator = (repayment: Repayment): ReactNode => {
    if (repayment.payment_status === "pending_confirmation") {
      return (
        <Badge className="gap-1 bg-blue-600 text-[11px] text-white hover:bg-blue-600">
          <RefreshCw className="h-3 w-3" /> Payment Pending Review
        </Badge>
      );
    }

    if (repayment.payment_status === "rejected") {
      return (
        <div className="space-y-1">
          <Badge className="gap-1 bg-rose-600 text-[11px] text-white hover:bg-rose-600">
            <XCircle className="h-3 w-3" /> Payment Rejected
          </Badge>
          {repayment.payment_rejection_reason && (
            <p className="max-w-[220px] text-[11px] text-rose-700">
              {repayment.payment_rejection_reason}
            </p>
          )}
        </div>
      );
    }

    if (repayment.payment_status === "confirmed" || repayment.status === "paid") {
      return (
        <Badge className="gap-1 bg-emerald-600 text-[11px] text-white hover:bg-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> Paid
        </Badge>
      );
    }

    if (repayment.status === "overdue") {
      return (
        <Badge className="gap-1 bg-rose-600 text-[11px] text-white hover:bg-rose-600">
          <AlertTriangle className="h-3 w-3" /> Overdue since {repayment.due_date}
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="gap-1 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3" /> Due {repayment.due_date}
      </Badge>
    );
  };

  const openMemberPayment = (repayment: Repayment) => {
    prepareMemberPayment(repayment);
    setPaymentDialogOpen(true);
  };

  const openOfficerPayment = (repayment: Repayment) => {
    setSelectedInstallmentId(repayment.id);
    setAmountToPay(
      String(Math.max(0, Number(repayment.amount_due) - Number(repayment.amount_paid))),
    );
    setPaymentMethod((repayment.payment_method as PaymentMethod) || "mpesa");
    setReference(repayment.reference ?? "");
    setPaymentDate(today);
    setNotes(repayment.notes ?? "");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setPaymentDialogOpen(false);
      }}
    >
      <DialogTrigger asChild>
        {triggerButton || (
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
            <CalendarDays className="h-3.5 w-3.5" /> Schedule
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Landmark className="h-5 w-5 text-primary" />
            Loan Repayment Schedule
            {memberEmail && (
              <span className="text-sm font-normal text-muted-foreground">({memberEmail})</span>
            )}
          </DialogTitle>
          <DialogDescription>
            Review each installment and submit a payment for treasurer confirmation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-7">
          <div className="rounded-lg border bg-card p-3 text-center">
            <span className="text-xs text-muted-foreground">Total Loan</span>
            <div className="text-lg font-semibold text-primary">{fmt(totalLoan)}</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <span className="text-xs text-muted-foreground">Total Paid</span>
            <div className="text-lg font-semibold text-emerald-600">{fmt(totalPaid)}</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <span className="text-xs text-muted-foreground">Outstanding</span>
            <div className="text-lg font-semibold text-rose-600">{fmt(outstandingBalance)}</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <span className="text-xs text-muted-foreground">Next Due</span>
            <div className="text-sm font-semibold text-foreground">
              {nextDue?.due_date ?? "None"}
            </div>
          </div>
          <div className="rounded-lg border bg-emerald-50 p-3 text-center text-emerald-950">
            <span className="text-xs">Paybill</span>
            <div className="text-lg font-semibold">522522</div>
          </div>
          <div className="rounded-lg border bg-emerald-50 p-3 text-center text-emerald-950">
            <span className="text-xs">Account</span>
            <div className="text-lg font-semibold">7989164</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <span className="text-xs text-muted-foreground">Overdue</span>
            <div
              className={`text-lg font-semibold ${overdueCount > 0 ? "text-rose-600" : "text-muted-foreground"}`}
            >
              {overdueCount}
            </div>
          </div>
        </div>

        {canRecordPayment && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-y py-2">
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
                  {generateSchedule.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlusCircle className="h-3.5 w-3.5" />
                  )}
                  {generateSchedule.isPending ? "Generating…" : "Generate Schedule"}
                </Button>
              )}
              {repayments.length > 0 && outstandingBalance > 0 && (
                <Button
                  size="sm"
                  variant={showOfficerPaymentForm ? "secondary" : "default"}
                  onClick={() => {
                    setShowOfficerPaymentForm(!showOfficerPaymentForm);
                    if (firstUnpaid) openOfficerPayment(firstUnpaid);
                  }}
                  className="gap-1 text-xs"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  {showOfficerPaymentForm ? "Hide Payment Form" : "Record Payment Received"}
                </Button>
              )}
            </div>
          </div>
        )}

        {showOfficerPaymentForm && canRecordPayment && (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
              <CreditCard className="h-4 w-4" /> Record Repayment Received
            </div>
            <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
              <div>
                <Label className="text-xs">Select Installment</Label>
                <Select
                  value={selectedInstallmentId || (firstUnpaid ? firstUnpaid.id : "")}
                  onValueChange={(value) => {
                    const repayment = repayments.find((item) => item.id === value);
                    setSelectedInstallmentId(value);
                    if (repayment) openOfficerPayment(repayment);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Choose installment" />
                  </SelectTrigger>
                  <SelectContent>
                    {repayments.map((repayment) => (
                      <SelectItem key={repayment.id} value={repayment.id}>
                        Installment #{repayment.installment_number} (Due: {repayment.due_date} —{" "}
                        {fmt(Number(repayment.amount_due))})
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
                  onChange={(event) => setAmountToPay(event.target.value)}
                  placeholder="Enter amount"
                />
              </div>
              <div>
                <Label className="text-xs">Payment Method</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(value: PaymentMethod) => setPaymentMethod(value)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mpesa">M-Pesa</SelectItem>
                    <SelectItem value="bank_transfer">Bank transfer</SelectItem>
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
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Payment Date</Label>
                <Input
                  type="date"
                  max={today}
                  className="h-8 text-xs"
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Notes (Optional)</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="Notes on installment"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowOfficerPaymentForm(false)}
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
                {recordPayment.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {recordPayment.isPending ? "Recording…" : "Save Payment"}
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Amount Due</TableHead>
                <TableHead>Amount Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment Info</TableHead>
                {canSubmitPayment && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={canSubmitPayment ? 7 : 6}
                    className="py-6 text-center text-xs text-muted-foreground"
                  >
                    Loading repayment schedule…
                  </TableCell>
                </TableRow>
              ) : repayments.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canSubmitPayment ? 7 : 6}
                    className="py-8 text-center text-xs text-muted-foreground"
                  >
                    No repayment schedule created yet. It will automatically generate upon loan
                    approval.
                  </TableCell>
                </TableRow>
              ) : (
                repayments.map((repayment) => {
                  const submitted = repayment.payment_status === "pending_confirmation";
                  const rejected = repayment.payment_status === "rejected";
                  return (
                    <TableRow key={repayment.id}>
                      <TableCell className="font-semibold text-xs">
                        #{repayment.installment_number}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {new Date(repayment.due_date).toLocaleDateString("en-KE", {
                          dateStyle: "medium",
                        })}
                      </TableCell>
                      <TableCell className="text-xs font-semibold">
                        {fmt(Number(repayment.amount_due))}
                      </TableCell>
                      <TableCell className="text-xs font-semibold text-emerald-600">
                        {fmt(Number(repayment.amount_paid))}
                      </TableCell>
                      <TableCell>{statusIndicator(repayment)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {submitted ? (
                          <div className="space-y-0.5">
                            <div className="font-medium text-foreground">
                              Ref:{" "}
                              <span className="font-mono">
                                {repayment.payment_reference ?? "—"}
                              </span>
                            </div>
                            <div>
                              Submitted:{" "}
                              {repayment.payment_submitted_at
                                ? new Date(repayment.payment_submitted_at).toLocaleDateString(
                                    "en-KE",
                                    {
                                      dateStyle: "short",
                                    },
                                  )
                                : "—"}
                            </div>
                          </div>
                        ) : repayment.payment_status === "confirmed" ||
                          repayment.status === "paid" ? (
                          <div>
                            <span className="font-medium text-foreground">
                              {methodLabel(repayment.payment_method)}
                            </span>
                            {(repayment.payment_reference || repayment.reference) && (
                              <span className="ml-1 font-mono">
                                ({repayment.payment_reference ?? repayment.reference})
                              </span>
                            )}
                            <div className="text-[10px]">
                              {repayment.paid_at
                                ? new Date(repayment.paid_at).toLocaleDateString("en-KE", {
                                    dateStyle: "short",
                                  })
                                : "—"}
                            </div>
                          </div>
                        ) : repayment.payment_rejection_reason ? (
                          <span className="text-rose-700">
                            {repayment.payment_rejection_reason}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      {canSubmitPayment && (
                        <TableCell className="text-right">
                          {canMemberSubmit(repayment) && (
                            <Button
                              size="sm"
                              className="gap-1 bg-amber-500 text-white hover:bg-amber-600"
                              onClick={() => openMemberPayment(repayment)}
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              {rejected ? "Re-submit Payment" : "Log Payment"}
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-serif">Log Loan Payment</DialogTitle>
              <DialogDescription>
                {selectedInstallment
                  ? `Installment #${selectedInstallment.installment_number} — ${fmt(Number(selectedInstallment.amount_due))}`
                  : "Select an installment to continue."}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
              <div className="mb-2 font-semibold">Pay via M-Pesa Paybill:</div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span>Business No:</span>
                <strong>522522</strong>
                <span>Account No:</span>
                <strong>7989164</strong>
              </div>
            </div>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitPayment.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor={`member-payment-amount-${loan.id}`}>Amount Paid *</Label>
                <Input
                  id={`member-payment-amount-${loan.id}`}
                  type="number"
                  min="1"
                  max={selectedInstallment ? Number(selectedInstallment.amount_due) : undefined}
                  step="0.01"
                  value={amountToPay}
                  onChange={(event) => setAmountToPay(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Enter the amount you paid via M-Pesa
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`member-payment-reference-${loan.id}`}>M-Pesa Reference *</Label>
                <Input
                  id={`member-payment-reference-${loan.id}`}
                  placeholder="e.g. QWE123456789"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">From your M-Pesa confirmation SMS</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`member-payment-method-${loan.id}`}>Payment Method</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(value: PaymentMethod) => setPaymentMethod(value)}
                >
                  <SelectTrigger id={`member-payment-method-${loan.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mpesa">M-Pesa</SelectItem>
                    <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`member-payment-date-${loan.id}`}>Payment Date *</Label>
                <Input
                  id={`member-payment-date-${loan.id}`}
                  type="date"
                  max={today}
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`member-payment-notes-${loan.id}`}>Notes (optional)</Label>
                <Textarea
                  id={`member-payment-notes-${loan.id}`}
                  placeholder="Any additional information..."
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPaymentDialogOpen(false)}
                  disabled={submitPayment.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-amber-500 text-white hover:bg-amber-600"
                  disabled={submitPayment.isPending || !selectedInstallment}
                >
                  {submitPayment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {submitPayment.isPending ? "Submitting…" : "Submit Payment"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
