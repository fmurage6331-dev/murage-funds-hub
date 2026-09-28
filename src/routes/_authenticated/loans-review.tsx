import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card } from "@/components/ui/card";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, CheckCircle2, Loader2, PlusCircle, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import { UnauthorizedCard } from "@/components/shared/UnauthorizedCard";
import { useRoles } from "@/hooks/use-roles";
import { attachMemberProfiles, type ProfileSummary } from "@/lib/member-profiles";
import { RepaymentScheduleDialog } from "@/components/loans/RepaymentScheduleDialog";
import {
  notifyLoanPaymentConfirmed,
  notifyLoanPaymentRejected,
  notifyLoanStatusChange,
} from "@/lib/notifications";

export const Route = createFileRoute("/_authenticated/loans-review")({
  component: Page,
});

type RepaymentRow = {
  status: string;
  due_date: string;
  amount_paid: number;
  amount_due: number;
};

type LoanRow = Tables<"loans"> & {
  profiles?: { full_name: string | null; email: string | null } | null;
  loan_repayments?: RepaymentRow[];
};

type PendingLoan = Pick<Tables<"loans">, "id" | "amount" | "member_id" | "loan_type"> & {
  profiles: ProfileSummary | null;
};

type PendingPayment = Tables<"loan_repayments"> & {
  loan: PendingLoan | null;
};

type ReviewTab = "pending-payments" | "loan-requests";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

const fmtAmount = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const statusColor = (status: string) =>
  status === "approved"
    ? "bg-success text-success-foreground"
    : status === "completed"
      ? "bg-emerald-600 text-white hover:bg-emerald-600"
      : status === "rejected"
        ? "bg-destructive/10 text-destructive"
        : status === "forwarded"
          ? "bg-primary/10 text-primary"
          : "bg-gold/20 text-gold";

function paymentMethodLabel(method: string | null): string {
  if (method === "bank_transfer" || method === "bank") return "Bank transfer";
  if (method === "mpesa") return "M-Pesa";
  if (method === "cash") return "Cash";
  return method || "—";
}

function Page() {
  const { user } = Route.useRouteContext();
  const roles = useRoles(user.id);
  const queryClient = useQueryClient();
  const canReviewLoans = roles.isFinanceOfficer;
  const canReviewPayments = roles.isAdmin || roles.isTreasurer;

  const [reviewTab, setReviewTab] = useState<ReviewTab>("pending-payments");
  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [confirmedAmount, setConfirmedAmount] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  // Officer "log loan on behalf of member" dialog state.
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [loanType, setLoanType] = useState<"project" | "emergency">("project");
  const [loanAmount, setLoanAmount] = useState("");
  const [loanPurpose, setLoanPurpose] = useState("");
  const [repaymentMonths, setRepaymentMonths] = useState("6");
  const [loanNotes, setLoanNotes] = useState("");

  const { data: loans = [], isLoading: loansLoading } = useQuery<LoanRow[]>({
    queryKey: ["loans", "review"],
    enabled: canReviewLoans,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("loans")
          .select("*, loan_repayments(*)")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (await attachMemberProfiles(data ?? [])) as LoanRow[];
      } catch (error) {
        console.error("Failed to load loan requests", error);
        throw error instanceof Error ? error : new Error("Could not load loan requests.");
      }
    },
  });

  const { data: pendingPayments = [], isLoading: pendingPaymentsLoading } = useQuery<
    PendingPayment[]
  >({
    queryKey: ["pending-loan-payments"],
    enabled: canReviewPayments,
    queryFn: async () => {
      try {
        const { data: repayments, error: repaymentsError } = await supabase
          .from("loan_repayments")
          .select("*")
          .eq("payment_status", "pending_confirmation")
          .order("payment_submitted_at", { ascending: true });
        if (repaymentsError) throw repaymentsError;

        const rows = repayments ?? [];
        const loanIds = [...new Set(rows.map((repayment) => repayment.loan_id))];
        if (loanIds.length === 0) return [];

        const { data: loansForPayments, error: loansError } = await supabase
          .from("loans")
          .select("id, amount, member_id, loan_type")
          .in("id", loanIds);
        if (loansError) throw loansError;

        const loansWithProfiles = await attachMemberProfiles(loansForPayments ?? []);
        const loanById = new Map<string, PendingLoan>(
          loansWithProfiles.map((loan) => [loan.id, loan]),
        );

        return rows.map((repayment) => ({
          ...repayment,
          loan: loanById.get(repayment.loan_id) ?? null,
        }));
      } catch (error) {
        console.error("Failed to load pending loan payments", error);
        throw error instanceof Error ? error : new Error("Could not load pending payments.");
      }
    },
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: approvedMembers = [] } = useQuery({
    queryKey: ["approved-members-for-officer-entry"],
    enabled: canReviewLoans,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone_number, email")
        .eq("status", "approved")
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    setReviewTab(canReviewPayments ? "pending-payments" : "loan-requests");
  }, [canReviewPayments]);

  useEffect(() => {
    if (!canReviewPayments) return;

    const channel = supabase
      .channel("loan-repayments-review-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loan_repayments",
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["pending-loan-payments"] });
          void queryClient.invalidateQueries({ queryKey: ["loans", "review"] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [canReviewPayments, queryClient]);

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return approvedMembers;
    const query = memberSearch.toLowerCase();
    return approvedMembers.filter((member) => {
      const name = (member.full_name ?? "").toLowerCase();
      const phone = (member.phone_number ?? "").toLowerCase();
      const email = (member.email ?? "").toLowerCase();
      return name.includes(query) || phone.includes(query) || email.includes(query);
    });
  }, [approvedMembers, memberSearch]);

  const currentRole = roles.isAdmin ? "admin" : roles.isChairman ? "chairman" : "treasurer";

  const openConfirmDialog = (payment: PendingPayment) => {
    setSelectedPayment(payment);
    const remaining = Math.max(0, Number(payment.amount_due) - Number(payment.amount_paid || 0));
    setConfirmedAmount(String(remaining));
    setConfirmDialogOpen(true);
  };

  const openRejectDialog = (payment: PendingPayment) => {
    setSelectedPayment(payment);
    setRejectionReason("");
    setRejectDialogOpen(true);
  };

  const confirmPayment = useMutation({
    mutationFn: async () => {
      try {
        if (!selectedPayment) throw new Error("Select a pending payment first.");
        const amount = Number(confirmedAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("The actual amount received must be greater than zero.");
        }

        const {
          data: { user: officer },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!officer) throw new Error("Please sign in again before confirming a payment.");

        const currentPaid = Number(selectedPayment.amount_paid || 0);
        const remaining = Math.max(0, Number(selectedPayment.amount_due) - currentPaid);
        if (amount > remaining) {
          throw new Error("The amount received cannot exceed the remaining installment balance.");
        }
        const newTotalPaid = currentPaid + amount;
        const confirmedAt = new Date().toISOString();
        const status = newTotalPaid >= Number(selectedPayment.amount_due) ? "paid" : "partial";
        const { data: updated, error } = await supabase
          .from("loan_repayments")
          .update({
            amount_paid: newTotalPaid,
            payment_status: "confirmed",
            status,
            paid_at: confirmedAt,
            payment_confirmed_by: officer.id,
            payment_confirmed_at: confirmedAt,
            recorded_by: officer.id,
            reference: selectedPayment.payment_reference,
          })
          .eq("id", selectedPayment.id)
          .eq("payment_status", "pending_confirmation")
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!updated) throw new Error("This payment has already been reviewed.");

        let outstandingBalance: number | undefined;
        const { data: loanRepayments, error: balanceError } = await supabase
          .from("loan_repayments")
          .select("amount_due, amount_paid, payment_status, status")
          .eq("loan_id", selectedPayment.loan_id);
        if (!balanceError) {
          const due = (loanRepayments ?? []).reduce(
            (sum, repayment) => sum + Number(repayment.amount_due),
            0,
          );
          const paid = (loanRepayments ?? [])
            .filter(
              (repayment) =>
                repayment.payment_status === "confirmed" || repayment.status === "paid",
            )
            .reduce((sum, repayment) => sum + Number(repayment.amount_paid), 0);
          outstandingBalance = Math.max(0, due - paid);
        }

        return { amount, outstandingBalance, confirmedAt };
      } catch (error) {
        throw error instanceof Error ? error : new Error("Could not confirm this payment.");
      }
    },
    onSuccess: ({ amount, outstandingBalance }) => {
      const memberName = selectedPayment?.loan?.profiles?.full_name ?? "the member";
      toast.success(`Payment of ${fmt(amount)} confirmed for ${memberName}`);
      setConfirmDialogOpen(false);
      setSelectedPayment(null);
      void queryClient.invalidateQueries({ queryKey: ["pending-loan-payments"] });
      void queryClient.invalidateQueries({ queryKey: ["loans", "review"] });
      void queryClient.invalidateQueries({ queryKey: ["my-loans"] });
      void queryClient.invalidateQueries({ queryKey: ["loan_repayments"] });

      const profile = selectedPayment?.loan?.profiles;
      if (profile && selectedPayment) {
        void notifyLoanPaymentConfirmed({
          memberEmail: profile.email ?? "",
          memberId: profile.id,
          memberPhone: profile.phone_number ?? undefined,
          memberName: profile.full_name ?? undefined,
          amount,
          paymentMethod: selectedPayment.payment_method ?? undefined,
          reference: selectedPayment.payment_reference ?? undefined,
          installmentNumber: selectedPayment.installment_number,
          outstandingBalance,
          confirmedAt: new Date().toISOString(),
        }).catch((error: unknown) => {
          console.warn("Failed sending loan payment confirmation notification", error);
        });
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectPayment = useMutation({
    mutationFn: async () => {
      try {
        if (!selectedPayment) throw new Error("Select a pending payment first.");
        const reason = rejectionReason.trim();
        if (!reason) throw new Error("A rejection reason is required.");

        const {
          data: { user: officer },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!officer) throw new Error("Please sign in again before rejecting a payment.");

        const rejectedAt = new Date().toISOString();
        const { data: updated, error } = await supabase
          .from("loan_repayments")
          .update({
            payment_status: "rejected",
            status: "pending",
            payment_rejection_reason: reason,
            payment_confirmed_by: officer.id,
            payment_confirmed_at: rejectedAt,
          })
          .eq("id", selectedPayment.id)
          .eq("payment_status", "pending_confirmation")
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!updated) throw new Error("This payment has already been reviewed.");
        return { reason, rejectedAt };
      } catch (error) {
        throw error instanceof Error ? error : new Error("Could not reject this payment.");
      }
    },
    onSuccess: ({ reason, rejectedAt }) => {
      toast.success("Payment rejected. Member has been notified.");
      setRejectDialogOpen(false);
      setSelectedPayment(null);
      void queryClient.invalidateQueries({ queryKey: ["pending-loan-payments"] });
      void queryClient.invalidateQueries({ queryKey: ["loans", "review"] });
      void queryClient.invalidateQueries({ queryKey: ["my-loans"] });
      void queryClient.invalidateQueries({ queryKey: ["loan_repayments"] });

      const profile = selectedPayment?.loan?.profiles;
      if (profile && selectedPayment) {
        void notifyLoanPaymentRejected({
          memberEmail: profile.email ?? "",
          memberId: profile.id,
          memberPhone: profile.phone_number ?? undefined,
          memberName: profile.full_name ?? undefined,
          amount: Number(selectedPayment.amount_due),
          paymentMethod: selectedPayment.payment_method ?? undefined,
          reference: selectedPayment.payment_reference ?? undefined,
          installmentNumber: selectedPayment.installment_number,
          reason,
          rejectedAt,
        }).catch((error: unknown) => {
          console.warn("Failed sending loan payment rejection notification", error);
        });
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const logOnBehalfMutation = useMutation({
    mutationFn: async () => {
      try {
        if (!selectedMemberId) throw new Error("Please select a member.");
        const parsedAmount = Number(loanAmount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          throw new Error("Amount must be greater than zero.");
        }
        if (!loanPurpose.trim()) throw new Error("Purpose is required.");
        const months = Number(repaymentMonths);
        if (!Number.isInteger(months) || months <= 0) {
          throw new Error("Repayment months must be a positive whole number.");
        }

        const purpose = loanNotes.trim()
          ? `${loanPurpose.trim()}\n\nOfficer note: ${loanNotes.trim()}`
          : loanPurpose.trim();
        const { error } = await supabase.from("loans").insert({
          member_id: selectedMemberId,
          loan_type: loanType,
          amount: parsedAmount,
          purpose,
          repayment_months: months,
          status: "submitted",
          entered_by: user.id,
          entered_by_role: currentRole,
          on_behalf_of: true,
        });
        if (error) throw error;
      } catch (error) {
        throw error instanceof Error ? error : new Error("Could not log the loan.");
      }
    },
    onSuccess: () => {
      toast.success("Loan request logged on behalf of member!");
      setLogDialogOpen(false);
      setSelectedMemberId("");
      setMemberSearch("");
      setLoanType("project");
      setLoanAmount("");
      setLoanPurpose("");
      setRepaymentMonths("6");
      setLoanNotes("");
      void queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleLogSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    logOnBehalfMutation.mutate();
  };

  const forward = useMutation({
    mutationFn: async ({ id, loan }: { id: string; loan?: LoanRow }) => {
      try {
        const { error } = await supabase
          .from("loans")
          .update({
            status: "forwarded",
            forwarded_by: user.id,
            forwarded_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (error) throw error;

        if (loan?.profiles?.email) {
          void notifyLoanStatusChange({
            memberEmail: loan.profiles.email,
            memberName: loan.profiles.full_name ?? undefined,
            loanAmount: Number(loan.amount),
            loanType: loan.loan_type,
            status: "forwarded",
            repaymentMonths: loan.repayment_months,
          }).catch((error: unknown) =>
            console.warn("Failed sending loan status notification", error),
          );
        }
      } catch (error) {
        throw error instanceof Error ? error : new Error("Could not forward this loan.");
      }
    },
    onSuccess: () => {
      toast.success("Forwarded to board");
      void queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectLoan = useMutation({
    mutationFn: async ({ id, loan }: { id: string; loan?: LoanRow }) => {
      try {
        const reason = window.prompt("Rejection reason?") ?? "";
        if (!reason) throw new Error("Reason required");
        const { error } = await supabase
          .from("loans")
          .update({
            status: "rejected",
            decision_at: new Date().toISOString(),
            rejection_reason: reason,
          })
          .eq("id", id);
        if (error) throw error;

        if (loan?.profiles?.email) {
          void notifyLoanStatusChange({
            memberEmail: loan.profiles.email,
            memberName: loan.profiles.full_name ?? undefined,
            loanAmount: Number(loan.amount),
            loanType: loan.loan_type,
            status: "rejected",
            reason,
            repaymentMonths: loan.repayment_months,
          }).catch((error: unknown) =>
            console.warn("Failed sending loan status notification", error),
          );
        }
      } catch (error) {
        throw error instanceof Error ? error : new Error("Could not reject this loan.");
      }
    },
    onSuccess: () => {
      toast.success("Rejected");
      void queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canDecide = roles.isChairman || roles.isAdmin;

  const approve = useMutation({
    mutationFn: async ({ id, loan }: { id: string; loan: LoanRow }) => {
      try {
        const { error } = await supabase
          .from("loans")
          .update({ status: "approved", decision_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;

        if (loan.profiles?.email) {
          void notifyLoanStatusChange({
            memberEmail: loan.profiles.email,
            memberName: loan.profiles.full_name ?? undefined,
            loanAmount: Number(loan.amount),
            loanType: loan.loan_type,
            status: "approved",
            repaymentMonths: loan.repayment_months,
          }).catch((error: unknown) =>
            console.warn("Failed sending loan status notification", error),
          );
        }
      } catch (error) {
        throw error instanceof Error ? error : new Error("Could not approve this loan.");
      }
    },
    onSuccess: () => {
      toast.success("Loan approved");
      void queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (roles.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  if (!roles.isAdmin && !roles.isTreasurer && !roles.isChairman) {
    return <UnauthorizedCard message="This page is restricted to officers." />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">Loans Review</h2>
          <p className="text-sm text-muted-foreground">
            Confirm member-submitted repayments and review loan requests in one place.
          </p>
        </div>
        {canReviewLoans && (
          <Button
            variant="outline"
            className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => setLogDialogOpen(true)}
          >
            <PlusCircle className="mr-2 h-4 w-4" /> Submit Loan for Member
          </Button>
        )}
      </div>

      <Tabs value={reviewTab} onValueChange={(value) => setReviewTab(value as ReviewTab)}>
        <TabsList>
          {canReviewPayments && (
            <TabsTrigger value="pending-payments" className="gap-2">
              Pending Payments
              <Badge className="bg-amber-500 px-1.5 py-0 text-[10px] text-white hover:bg-amber-500">
                {pendingPayments.length}
              </Badge>
            </TabsTrigger>
          )}
          <TabsTrigger value="loan-requests">Loan Requests</TabsTrigger>
        </TabsList>

        {canReviewPayments && (
          <TabsContent value="pending-payments" className="mt-4">
            <Card>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member Name</TableHead>
                      <TableHead>Loan Amount</TableHead>
                      <TableHead>Installment #</TableHead>
                      <TableHead>Amount Due</TableHead>
                      <TableHead>Reference Submitted</TableHead>
                      <TableHead>Payment Method</TableHead>
                      <TableHead>Submitted Date</TableHead>
                      <TableHead>Member Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingPaymentsLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                          Loading pending payments…
                        </TableCell>
                      </TableRow>
                    ) : pendingPayments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                          No loan payments are waiting for confirmation.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pendingPayments.map((payment) => {
                        const profile = payment.loan?.profiles;
                        return (
                          <TableRow key={payment.id}>
                            <TableCell>
                              <div className="font-medium">
                                {profile?.full_name ?? "Unknown member"}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {profile?.email ?? "—"}
                              </div>
                            </TableCell>
                            <TableCell>{fmt(Number(payment.loan?.amount ?? 0))}</TableCell>
                            <TableCell>#{payment.installment_number}</TableCell>
                            <TableCell className="font-medium">
                              {fmtAmount(Number(payment.amount_due))}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {payment.payment_reference ?? "—"}
                            </TableCell>
                            <TableCell>{paymentMethodLabel(payment.payment_method)}</TableCell>
                            <TableCell className="text-xs">
                              {payment.payment_submitted_at
                                ? new Date(payment.payment_submitted_at).toLocaleString("en-KE", {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  })
                                : "—"}
                            </TableCell>
                            <TableCell className="max-w-[220px] whitespace-pre-wrap text-xs text-muted-foreground">
                              {payment.member_notes ?? "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
                                  disabled={confirmPayment.isPending || rejectPayment.isPending}
                                  onClick={() => openConfirmDialog(payment)}
                                >
                                  <Check className="h-3.5 w-3.5" /> Confirm
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1 border-rose-300 text-rose-700 hover:bg-rose-50"
                                  disabled={confirmPayment.isPending || rejectPayment.isPending}
                                  onClick={() => openRejectDialog(payment)}
                                >
                                  <X className="h-3.5 w-3.5" /> Reject
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="loan-requests" className="mt-4">
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Repay</TableHead>
                    <TableHead>Eligibility</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-40">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loansLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : loans.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                        No loan requests.
                      </TableCell>
                    </TableRow>
                  ) : (
                    loans.map((loan) => {
                      const profile = loan.profiles ?? null;
                      const overdueCount = (loan.loan_repayments ?? []).filter(
                        (repayment) =>
                          repayment.status === "overdue" ||
                          (new Date(repayment.due_date) < new Date() &&
                            Number(repayment.amount_paid) < Number(repayment.amount_due)),
                      ).length;
                      return (
                        <TableRow key={loan.id}>
                          <TableCell>
                            <div className="font-medium">{profile?.full_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{profile?.email}</div>
                            {loan.on_behalf_of && (
                              <Badge className="mt-1 bg-amber-600 text-white hover:bg-amber-600">
                                Officer Entry
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{new Date(loan.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {loan.loan_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-xs truncate">{loan.purpose}</TableCell>
                          <TableCell>{loan.repayment_months} mo</TableCell>
                          <TableCell className="max-w-[220px] text-xs">
                            <div
                              className={loan.auto_eligible ? "text-success" : "text-destructive"}
                            >
                              {loan.auto_eligible ? "Meets criteria" : "Below criteria"}
                            </div>
                            <div className="text-muted-foreground">{loan.eligibility_note}</div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge className={statusColor(loan.status)}>{loan.status}</Badge>
                              {loan.status === "approved" && overdueCount > 0 && (
                                <Badge
                                  variant="destructive"
                                  className="justify-center px-1 py-0 text-[10px]"
                                >
                                  ⚠️ {overdueCount} Overdue
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {fmt(Number(loan.amount))}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {loan.status === "submitted" &&
                                (roles.isTreasurer || roles.isAdmin) && (
                                  <Button
                                    size="sm"
                                    disabled={forward.isPending}
                                    onClick={() => forward.mutate({ id: loan.id, loan })}
                                  >
                                    <Send className="mr-1 h-3 w-3" />
                                    {forward.isPending
                                      ? "Forwarding…"
                                      : "Forward to Board for Voting"}
                                  </Button>
                                )}
                              {canDecide &&
                                (loan.status === "submitted" || loan.status === "forwarded") && (
                                  <>
                                    <Button
                                      size="sm"
                                      disabled={approve.isPending || rejectLoan.isPending}
                                      onClick={() => approve.mutate({ id: loan.id, loan })}
                                    >
                                      {approve.isPending ? "Approving…" : "Approve"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={approve.isPending || rejectLoan.isPending}
                                      onClick={() => rejectLoan.mutate({ id: loan.id, loan })}
                                    >
                                      Reject
                                    </Button>
                                  </>
                                )}
                              {loan.status === "approved" && (
                                <RepaymentScheduleDialog
                                  loan={loan}
                                  canRecordPayment={roles.isAdmin || roles.isTreasurer}
                                  memberEmail={profile?.email ?? undefined}
                                />
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm loan payment</DialogTitle>
            <DialogDescription>
              Confirm payment of {fmtAmount(Number(selectedPayment?.amount_due ?? 0))}? Payment
              reference: {selectedPayment?.payment_reference ?? "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="actual-amount-received">Actual amount received (KES)</Label>
            <Input
              id="actual-amount-received"
              type="number"
              min="0.01"
              step="0.01"
              value={confirmedAmount}
              onChange={(event) => setConfirmedAmount(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Use this field if the amount received differs from the installment amount due.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialogOpen(false)}
              disabled={confirmPayment.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => confirmPayment.mutate()}
              disabled={confirmPayment.isPending || !selectedPayment}
            >
              {confirmPayment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmPayment.isPending ? "Confirming…" : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject loan payment</DialogTitle>
            <DialogDescription>
              Explain why the payment with reference {selectedPayment?.payment_reference ?? "—"}{" "}
              cannot be confirmed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="payment-rejection-reason">Rejection reason *</Label>
            <Textarea
              id="payment-rejection-reason"
              rows={4}
              required
              placeholder="For example: Reference does not match the M-Pesa statement."
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
              disabled={rejectPayment.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejectPayment.mutate()}
              disabled={rejectPayment.isPending || !selectedPayment || !rejectionReason.trim()}
            >
              {rejectPayment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {rejectPayment.isPending ? "Rejecting…" : "Reject Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Log Loan for Member</DialogTitle>
            <DialogDescription>
              Record a loan request on behalf of a member without web access. It still follows the
              normal board approval flow.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleLogSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="officer-loan-member">Member *</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="officer-loan-member"
                  placeholder="Search by name or phone…"
                  className="pl-8"
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                />
              </div>
              <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an approved member" />
                </SelectTrigger>
                <SelectContent>
                  {filteredMembers.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No members found
                    </div>
                  ) : (
                    filteredMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.full_name ?? "Unnamed"} —{" "}
                        {member.phone_number ?? member.email ?? "no contact"}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="officer-loan-type">Loan Type *</Label>
              <Select
                value={loanType}
                onValueChange={(value: "project" | "emergency") => setLoanType(value)}
              >
                <SelectTrigger id="officer-loan-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="emergency">Emergency</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="officer-loan-amount">Amount (KES) *</Label>
                <Input
                  id="officer-loan-amount"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="0"
                  value={loanAmount}
                  onChange={(event) => setLoanAmount(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="officer-loan-months">Repayment Months *</Label>
                <Input
                  id="officer-loan-months"
                  type="number"
                  min="1"
                  step="1"
                  value={repaymentMonths}
                  onChange={(event) => setRepaymentMonths(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="officer-loan-purpose">Purpose *</Label>
              <Textarea
                id="officer-loan-purpose"
                rows={3}
                placeholder="What is the loan for?"
                value={loanPurpose}
                onChange={(event) => setLoanPurpose(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="officer-loan-notes">Officer Notes (optional)</Label>
              <Textarea
                id="officer-loan-notes"
                rows={2}
                placeholder="Any notes for the board"
                value={loanNotes}
                onChange={(event) => setLoanNotes(event.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setLogDialogOpen(false)}
                disabled={logOnBehalfMutation.isPending}
              >
                <X className="mr-1 h-4 w-4" /> Cancel
              </Button>
              <Button type="submit" disabled={logOnBehalfMutation.isPending}>
                {logOnBehalfMutation.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                )}
                {logOnBehalfMutation.isPending ? "Logging…" : "Log Loan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
