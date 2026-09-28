import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  Plus,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { RepaymentScheduleDialog } from "@/components/loans/RepaymentScheduleDialog";

export const Route = createFileRoute("/_authenticated/my-loans")({
  component: Page,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

type MyLoan = Tables<"loans"> & {
  loan_repayments: Tables<"loan_repayments">[];
};

type Repayment = Tables<"loan_repayments">;

const statusColor = (status: string) =>
  status === "approved"
    ? "bg-success text-success-foreground"
    : status === "rejected"
      ? "bg-destructive/10 text-destructive"
      : status === "forwarded"
        ? "bg-primary/10 text-primary"
        : "bg-gold/20 text-gold";

function isConfirmed(repayment: Repayment): boolean {
  return repayment.payment_status === "confirmed" || repayment.status === "paid";
}

function canLogPayment(repayment: Repayment): boolean {
  return (
    (repayment.status === "pending" || repayment.status === "overdue") &&
    (repayment.payment_status === "not_paid" || repayment.payment_status === "rejected")
  );
}

function Page() {
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();

  const { data: loans = [], isLoading } = useQuery<MyLoan[]>({
    queryKey: ["my-loans", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loans")
        .select("*, loan_repayments(*)")
        .eq("member_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MyLoan[];
    },
  });

  const { data: rulesByType } = useQuery({
    queryKey: ["loan-rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("loan_rules").select("*").eq("active", true);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((rule) => [rule.loan_type, rule]));
    },
  });

  const { data: confirmed = 0 } = useQuery({
    queryKey: ["confirmed-total", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .select("amount")
        .eq("member_id", user.id)
        .eq("status", "confirmed");
      if (error) throw error;
      return (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
    },
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    loan_type: "project" | "emergency";
    amount: string;
    purpose: string;
    repayment_months: string;
  }>({
    loan_type: "project",
    amount: "",
    purpose: "",
    repayment_months: "6",
  });
  const activeRules = rulesByType?.[form.loan_type];
  const activeLoans = useMemo(() => loans.filter((loan) => loan.status === "approved"), [loans]);

  const create = useMutation({
    mutationFn: async () => {
      try {
        const amount = Number(form.amount);
        const months = Number(form.repayment_months);
        if (!Number.isFinite(amount) || amount <= 0)
          throw new Error("Amount must be greater than zero.");
        if (!Number.isInteger(months) || months <= 0) {
          throw new Error("Repayment period must be a positive whole number.");
        }
        if (!form.purpose.trim()) throw new Error("Purpose is required.");

        const { error } = await supabase.from("loans").insert({
          member_id: user.id,
          loan_type: form.loan_type,
          amount,
          purpose: form.purpose.trim(),
          repayment_months: months,
        });
        if (error) throw error;
      } catch (error) {
        throw error instanceof Error ? error : new Error("Could not submit the loan request.");
      }
    },
    onSuccess: () => {
      toast.success("Loan request submitted");
      setOpen(false);
      setForm({ loan_type: "project", amount: "", purpose: "", repayment_months: "6" });
      void queryClient.invalidateQueries({ queryKey: ["my-loans"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">My Loans</h2>
          <p className="text-sm text-muted-foreground">
            Request a loan against your contributions and keep your repayments up to date.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Request loan
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif">Request a loan</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <Label>Loan type</Label>
                <Select
                  value={form.loan_type}
                  onValueChange={(value: "project" | "emergency") =>
                    setForm({ ...form, loan_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project">Project loan</SelectItem>
                    <SelectItem value="emergency">Emergency loan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {activeRules && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  Eligibility: up to {activeRules.max_multiplier}× confirmed contributions (max{" "}
                  {fmt(Number(activeRules.max_amount))}), repaid within{" "}
                  {activeRules.max_repayment_months} months, minimum{" "}
                  {activeRules.min_membership_days} days membership,{" "}
                  {activeRules.interest_rate_percent}% interest. Your confirmed contributions:{" "}
                  <span className="font-medium text-foreground">{fmt(confirmed)}</span>.
                </div>
              )}
              <div>
                <Label>Amount (KES)</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: event.target.value })}
                />
              </div>
              <div>
                <Label>Repayment period (months)</Label>
                <Input
                  type="number"
                  min="1"
                  required
                  value={form.repayment_months}
                  onChange={(event) => setForm({ ...form, repayment_months: event.target.value })}
                />
              </div>
              <div>
                <Label>Purpose</Label>
                <Textarea
                  rows={3}
                  required
                  value={form.purpose}
                  onChange={(event) => setForm({ ...form, purpose: event.target.value })}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Submitting…" : "Submit request"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {activeLoans.length > 0 && (
        <section className="space-y-3" aria-labelledby="active-loans-heading">
          <div>
            <h3 id="active-loans-heading" className="font-serif text-xl font-semibold text-primary">
              Active loan payment overview
            </h3>
            <p className="text-sm text-muted-foreground">
              Confirmed payments update your outstanding balance. Member-submitted payments remain
              pending until reviewed.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {activeLoans.map((loan) => {
              const repayments = loan.loan_repayments ?? [];
              const totalPaid = repayments
                .filter(isConfirmed)
                .reduce((sum, repayment) => sum + Number(repayment.amount_paid || 0), 0);
              const outstanding = Math.max(0, Number(loan.amount) - totalPaid);
              const progress = Math.min(
                100,
                Math.round((totalPaid / Math.max(1, Number(loan.amount))) * 100),
              );
              const overdue = repayments.some(
                (repayment) => repayment.status === "overdue" && !isConfirmed(repayment),
              );
              const next = repayments.find((repayment) => !isConfirmed(repayment));
              const paymentIsPending = next?.payment_status === "pending_confirmation";
              const paymentCanBeLogged = next ? canLogPayment(next) : false;
              const progressColor = overdue
                ? "bg-rose-500"
                : progress < 40
                  ? "bg-amber-500"
                  : "bg-emerald-500";
              const interestRate = rulesByType?.[loan.loan_type]?.interest_rate_percent;
              const monthlyAmount =
                repayments.length > 0
                  ? repayments.reduce((sum, repayment) => sum + Number(repayment.amount_due), 0) /
                    repayments.length
                  : Number(loan.amount) / Math.max(1, loan.repayment_months);

              return (
                <Card key={loan.id} className={overdue ? "border-rose-200" : undefined}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="font-serif capitalize">
                          {loan.loan_type} loan
                        </CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Approved{" "}
                          {new Date(loan.decision_at ?? loan.created_at).toLocaleDateString(
                            "en-KE",
                          )}
                        </p>
                      </div>
                      <Badge className={statusColor(loan.status)}>{loan.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <div className="text-xs text-muted-foreground">Amount borrowed</div>
                        <div className="font-semibold">{fmt(Number(loan.amount))}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Total paid</div>
                        <div className="font-semibold text-emerald-600">{fmt(totalPaid)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Outstanding</div>
                        <div className="font-semibold text-rose-600">{fmt(outstanding)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Interest rate</div>
                        <div className="font-semibold">{interestRate ?? "—"}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Monthly payment</div>
                        <div className="font-semibold">{fmt(monthlyAmount)}</div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Payment progress</span>
                        <span className="font-medium text-foreground">{progress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all ${progressColor}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div
                        className={`text-xs ${overdue ? "text-rose-700" : "text-muted-foreground"}`}
                      >
                        {overdue ? "Overdue payment requires attention" : "On track"}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-start gap-2">
                        {next ? (
                          overdue ? (
                            <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-600" />
                          ) : paymentIsPending ? (
                            <Clock className="mt-0.5 h-4 w-4 text-blue-600" />
                          ) : (
                            <CalendarDays className="mt-0.5 h-4 w-4 text-primary" />
                          )
                        ) : (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                        )}
                        <div>
                          <div className="text-xs font-medium">Next payment due</div>
                          <div className="text-sm font-semibold">
                            {next
                              ? `${new Date(next.due_date).toLocaleDateString("en-KE")} · ${fmt(Number(next.amount_due))}`
                              : "All installments paid"}
                          </div>
                          {paymentIsPending && (
                            <div className="text-xs text-blue-700">Awaiting Confirmation</div>
                          )}
                        </div>
                      </div>
                      {paymentCanBeLogged && next && (
                        <RepaymentScheduleDialog
                          loan={loan}
                          canSubmitPayment
                          defaultInstallmentId={next.id}
                          openPaymentFormOnOpen
                          memberEmail={user.email ?? undefined}
                          triggerButton={
                            <Button
                              size="sm"
                              className="gap-1 bg-amber-500 text-white hover:bg-amber-600"
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              {next.payment_status === "rejected"
                                ? "Re-submit Payment"
                                : "Log Payment"}
                            </Button>
                          }
                        />
                      )}
                      {paymentIsPending && (
                        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
                          Awaiting Confirmation
                        </Badge>
                      )}
                    </div>

                    <RepaymentScheduleDialog
                      loan={loan}
                      canSubmitPayment
                      memberEmail={user.email ?? undefined}
                      triggerButton={
                        <Button variant="outline" size="sm" className="w-full gap-2">
                          <Eye className="h-3.5 w-3.5" /> View Full Schedule
                        </Button>
                      }
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Repayment</TableHead>
              <TableHead>Eligibility</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-36 text-center">Schedule</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : loans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No loan requests yet.
                </TableCell>
              </TableRow>
            ) : (
              loans.map((loan) => (
                <TableRow key={loan.id}>
                  <TableCell>{new Date(loan.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {loan.loan_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{loan.purpose}</TableCell>
                  <TableCell>{loan.repayment_months} mo</TableCell>
                  <TableCell className="max-w-xs text-xs text-muted-foreground">
                    {loan.auto_eligible ? (
                      <span className="text-success">Meets criteria</span>
                    ) : (
                      <span title={loan.eligibility_note ?? ""}>Needs board review</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColor(loan.status)}>{loan.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {fmt(Number(loan.amount))}
                  </TableCell>
                  <TableCell className="text-center">
                    {loan.status === "approved" ? (
                      <RepaymentScheduleDialog
                        loan={loan}
                        canSubmitPayment
                        memberEmail={user.email ?? undefined}
                        triggerButton={
                          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                            <CalendarDays className="h-3.5 w-3.5" /> View Schedule
                          </Button>
                        }
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
