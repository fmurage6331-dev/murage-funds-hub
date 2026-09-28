import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, PlusCircle, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import { UnauthorizedCard } from "@/components/shared/UnauthorizedCard";
import type { Tables } from "@/integrations/supabase/types";
import { useRoles } from "@/hooks/use-roles";
import { attachMemberProfiles } from "@/lib/member-profiles";
import { RepaymentScheduleDialog } from "@/components/loans/RepaymentScheduleDialog";
import { notifyLoanStatusChange } from "@/lib/notifications";

export const Route = createFileRoute("/_authenticated/loans-review")({
  component: Page,
});

/** Minimal shape of the embedded repayment rows used for the overdue badge. */
type RepaymentRow = {
  status: string;
  due_date: string;
  amount_paid: number;
  amount_due: number;
};

/** A loan row plus the member profile merged in client-side. */
type LoanRow = Tables<"loans"> & {
  profiles?: { full_name: string | null; email: string | null } | null;
  loan_repayments?: RepaymentRow[];
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);
const statusColor = (s: string) =>
  s === "approved"
    ? "bg-success text-success-foreground"
    : s === "rejected"
      ? "bg-destructive/10 text-destructive"
      : s === "forwarded"
        ? "bg-primary/10 text-primary"
        : "bg-gold/20 text-gold";

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const qc = useQueryClient();

  // Officer "log loan on behalf of member" dialog state
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [loanType, setLoanType] = useState<"project" | "emergency">("project");
  const [loanAmount, setLoanAmount] = useState("");
  const [loanPurpose, setLoanPurpose] = useState("");
  const [repaymentMonths, setRepaymentMonths] = useState("6");
  const [loanNotes, setLoanNotes] = useState("");

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loans", "review"],
    enabled: r.isFinanceOfficer,
    queryFn: async () => {
      try {
        // `loans.member_id` points at `auth.users`, so the `profiles` embed is
        // unresolvable; repayments have a real FK and stay embedded.
        const { data, error } = await supabase
          .from("loans")
          .select("*, loan_repayments(*)")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (await attachMemberProfiles(data ?? [])) as LoanRow[];
      } catch (error) {
        console.error("Failed to load loan requests", error);
        toast.error("Could not load loan requests.");
        return [];
      }
    },
  });

  // Approved members query for the searchable member selector
  const { data: approvedMembers = [] } = useQuery({
    queryKey: ["approved-members-for-officer-entry"],
    enabled: r.isFinanceOfficer,
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

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return approvedMembers;
    const q = memberSearch.toLowerCase();
    return approvedMembers.filter((m) => {
      const name = (m.full_name ?? "").toLowerCase();
      const phone = (m.phone_number ?? "").toLowerCase();
      const email = (m.email ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || email.includes(q);
    });
  }, [approvedMembers, memberSearch]);

  const currentRole = r.isAdmin ? "admin" : r.isChairman ? "chairman" : "treasurer";

  const logOnBehalfMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMemberId) throw new Error("Please select a member.");
      const parsedAmount = Number(loanAmount);
      if (isNaN(parsedAmount) || parsedAmount <= 0)
        throw new Error("Amount must be greater than zero.");
      if (!loanPurpose.trim()) throw new Error("Purpose is required.");
      const months = Number(repaymentMonths);
      if (isNaN(months) || months <= 0 || !Number.isInteger(months))
        throw new Error("Repayment months must be a positive whole number.");

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
      qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    logOnBehalfMutation.mutate();
  };

  const forward = useMutation({
    mutationFn: async ({ id, loan }: { id: string; loan?: LoanRow }) => {
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
        notifyLoanStatusChange({
          memberEmail: loan.profiles.email,
          memberName: loan.profiles.full_name ?? undefined,
          loanAmount: Number(loan.amount),
          loanType: loan.loan_type,
          status: "forwarded",
          repaymentMonths: loan.repayment_months,
        }).catch((e) => console.warn("Failed sending loan status notification", e));
      }
    },
    onSuccess: () => {
      toast.success("Forwarded to board");
      qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async ({ id, loan }: { id: string; loan?: LoanRow }) => {
      const reason = prompt("Rejection reason?") ?? "";
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
        notifyLoanStatusChange({
          memberEmail: loan.profiles.email,
          memberName: loan.profiles.full_name ?? undefined,
          loanAmount: Number(loan.amount),
          loanType: loan.loan_type,
          status: "rejected",
          reason,
          repaymentMonths: loan.repayment_months,
        }).catch((e) => console.warn("Failed sending loan status notification", e));
      }
    },
    onSuccess: () => {
      toast.success("Rejected");
      qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canDecide = r.isChairman || r.isAdmin;

  const approve = useMutation({
    mutationFn: async ({ id, loan }: { id: string; loan: LoanRow }) => {
      const { error } = await supabase
        .from("loans")
        .update({ status: "approved", decision_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;

      const profile = loan.profiles ?? null;
      if (profile?.email) {
        void notifyLoanStatusChange({
          memberEmail: profile.email,
          memberName: profile.full_name ?? undefined,
          loanAmount: Number(loan.amount),
          loanType: loan.loan_type,
          status: "approved",
          repaymentMonths: loan.repayment_months,
        }).catch((e) => console.warn("Failed sending loan status notification", e));
      }
    },
    onSuccess: () => {
      toast.success("Loan approved");
      void qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (r.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  if (!r.isAdmin && !r.isTreasurer && !r.isChairman) {
    return <UnauthorizedCard message="This page is restricted to officers." />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">Loan Requests</h2>
          <p className="text-sm text-muted-foreground">
            The treasurer forwards eligible requests; the chairman or admin gives final approval.
          </p>
        </div>
        {r.isFinanceOfficer && (
          <Button
            variant="outline"
            className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => setLogDialogOpen(true)}
          >
            <PlusCircle className="mr-2 h-4 w-4" /> Submit Loan for Member
          </Button>
        )}
      </div>
      <Card>
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
            {isLoading ? (
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
              loans.map((l) => {
                const p = l.profiles ?? null;
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="font-medium">{p?.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{p?.email}</div>
                      {l.on_behalf_of && (
                        <Badge className="mt-1 bg-amber-600 text-white hover:bg-amber-600">
                          Officer Entry
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{new Date(l.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {l.loan_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{l.purpose}</TableCell>
                    <TableCell>{l.repayment_months} mo</TableCell>
                    <TableCell className="max-w-[220px] text-xs">
                      <div className={l.auto_eligible ? "text-success" : "text-destructive"}>
                        {l.auto_eligible ? "Meets criteria" : "Below criteria"}
                      </div>
                      <div className="text-muted-foreground">{l.eligibility_note}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge className={statusColor(l.status)}>{l.status}</Badge>
                        {l.status === "approved" &&
                          (() => {
                            const reps = l.loan_repayments ?? [];
                            const overdueCount = reps.filter(
                              (repayment) =>
                                repayment.status === "overdue" ||
                                (new Date(repayment.due_date) < new Date() &&
                                  Number(repayment.amount_paid) < Number(repayment.amount_due)),
                            ).length;
                            return overdueCount > 0 ? (
                              <Badge
                                variant="destructive"
                                className="text-[10px] px-1 py-0 justify-center"
                              >
                                ⚠️ {overdueCount} Overdue
                              </Badge>
                            ) : null;
                          })()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {fmt(Number(l.amount))}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {l.status === "submitted" && (r.isTreasurer || r.isAdmin) && (
                          <Button
                            size="sm"
                            disabled={forward.isPending}
                            onClick={() => forward.mutate({ id: l.id, loan: l })}
                          >
                            <Send className="mr-1 h-3 w-3" />
                            {forward.isPending ? "Forwarding…" : "Forward to Board for Voting"}
                          </Button>
                        )}
                        {canDecide && (l.status === "submitted" || l.status === "forwarded") && (
                          <>
                            <Button
                              size="sm"
                              disabled={approve.isPending || reject.isPending}
                              onClick={() => approve.mutate({ id: l.id, loan: l })}
                            >
                              {approve.isPending ? "Approving…" : "Approve"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={approve.isPending || reject.isPending}
                              onClick={() => reject.mutate({ id: l.id, loan: l })}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {l.status === "approved" && (
                          <RepaymentScheduleDialog
                            loan={l}
                            canRecordPayment={r.isAdmin || r.isTreasurer}
                            memberEmail={p?.email ?? undefined}
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
      </Card>

      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Log Loan for Member</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Record a loan request on behalf of a member without web access. It still follows the
              normal board approval flow.
            </p>
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
                  onChange={(e) => setMemberSearch(e.target.value)}
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
                    filteredMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name ?? "Unnamed"} — {m.phone_number ?? m.email ?? "no contact"}
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
                onValueChange={(v: "project" | "emergency") => setLoanType(v)}
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
                  onChange={(e) => setLoanAmount(e.target.value)}
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
                  onChange={(e) => setRepaymentMonths(e.target.value)}
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
                onChange={(e) => setLoanPurpose(e.target.value)}
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
                onChange={(e) => setLoanNotes(e.target.value)}
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
                <Check className="mr-1 h-4 w-4" />
                {logOnBehalfMutation.isPending ? "Logging…" : "Log Loan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
