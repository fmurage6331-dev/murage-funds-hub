import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useRoles } from "@/hooks/use-roles";
import { RepaymentScheduleDialog } from "@/components/loans/RepaymentScheduleDialog";
import { ArrowLeft, CalendarDays, HandCoins, PlusCircle, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/member-profile/$memberId")({
  component: Page,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

const dateLabel = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : "—";

const statusBadgeClass = (status: string) =>
  status === "approved" || status === "confirmed" || status === "paid"
    ? "bg-success text-success-foreground"
    : status === "rejected" || status === "overdue"
      ? "bg-destructive/10 text-destructive"
      : "bg-gold/20 text-gold";

function Page() {
  const { user } = Route.useRouteContext();
  const { memberId } = Route.useParams();
  const r = useRoles(user.id);
  const qc = useQueryClient();

  const canView = r.isAdmin || r.isTreasurer || r.isChairman;

  const { data: profile, isLoading } = useQuery({
    queryKey: ["member-profile", memberId],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", memberId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["member-profile-roles", memberId],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", memberId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: contributions = [] } = useQuery({
    queryKey: ["member-profile-contributions", memberId],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .select("*")
        .eq("member_id", memberId)
        .order("contributed_on", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: loans = [] } = useQuery({
    queryKey: ["member-profile-loans", memberId],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loans")
        .select("*")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const loanIds = useMemo(() => loans.map((l) => l.id), [loans]);

  const { data: repayments = [] } = useQuery({
    queryKey: ["member-profile-repayments", memberId, loanIds],
    enabled: canView && loanIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loan_repayments")
        .select("*")
        .in("loan_id", loanIds)
        .order("installment_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const confirmedContribs = contributions.filter((c) => c.status === "confirmed");
  const totalContributions = confirmedContribs.reduce((sum, c) => sum + Number(c.amount), 0);
  const latestContribution = confirmedContribs[0]?.contributed_on ?? null;

  const activeLoans = loans.filter((l) => l.status === "approved");
  const totalLoans = loans.reduce((sum, l) => sum + Number(l.amount), 0);
  const totalRepaid = repayments.reduce((sum, rp) => sum + Number(rp.amount_paid ?? 0), 0);
  const totalOutstandingApproved = activeLoans.reduce((sum, l) => sum + Number(l.amount), 0);
  const outstanding = Math.max(0, totalOutstandingApproved - totalRepaid);
  const nextDue = repayments
    .filter((rp) => rp.status !== "paid" && Number(rp.amount_paid ?? 0) < Number(rp.amount_due))
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0];

  const repaymentsByLoan = useMemo(() => {
    const map = new Map<string, typeof repayments>();
    repayments.forEach((rp) => {
      const list = map.get(rp.loan_id) ?? [];
      list.push(rp);
      map.set(rp.loan_id, list);
    });
    return map;
  }, [repayments]);

  const currentRole = r.isAdmin ? "admin" : r.isChairman ? "chairman" : "treasurer";

  // ── Quick action: contribution on behalf of this member ──
  const [contribOpen, setContribOpen] = useState(false);
  const [contribAmount, setContribAmount] = useState("");
  const [contribRef, setContribRef] = useState("");
  const [contribDate, setContribDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [contribMethod, setContribMethod] = useState("mpesa");
  const [contribNotes, setContribNotes] = useState("");

  const logContribution = useMutation({
    mutationFn: async () => {
      const parsedAmount = Number(contribAmount);
      if (Number.isNaN(parsedAmount) || parsedAmount < 1)
        throw new Error("Amount must be at least 1 KES.");
      if (!contribRef.trim()) throw new Error("M-Pesa Reference is required.");
      if (!contribDate) throw new Error("Date is required.");

      const { error } = await supabase.from("contributions").insert({
        member_id: memberId,
        amount: parsedAmount,
        status: "confirmed",
        method: contribMethod,
        reference: contribRef.trim(),
        contributed_on: contribDate,
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
        entered_by: user.id,
        entered_by_role: currentRole,
        on_behalf_of: true,
        paybill_number: "522522",
        mpesa_transaction_id: contribRef.trim(),
        notes: contribNotes.trim() ? contribNotes.trim() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contribution logged on behalf of member.");
      setContribOpen(false);
      setContribAmount("");
      setContribRef("");
      setContribDate(new Date().toISOString().slice(0, 10));
      setContribMethod("mpesa");
      setContribNotes("");
      qc.invalidateQueries({ queryKey: ["member-profile-contributions", memberId] });
      qc.invalidateQueries({ queryKey: ["member-profile", memberId] });
      qc.invalidateQueries({ queryKey: ["contributions-review"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Quick action: loan on behalf of this member ──
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanType, setLoanType] = useState<"project" | "emergency">("project");
  const [loanAmount, setLoanAmount] = useState("");
  const [loanPurpose, setLoanPurpose] = useState("");
  const [loanMonths, setLoanMonths] = useState("6");
  const [loanNotes, setLoanNotes] = useState("");

  const logLoan = useMutation({
    mutationFn: async () => {
      const parsedAmount = Number(loanAmount);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0)
        throw new Error("Amount must be greater than zero.");
      if (!loanPurpose.trim()) throw new Error("Purpose is required.");
      const months = Number(loanMonths);
      if (Number.isNaN(months) || months <= 0 || !Number.isInteger(months))
        throw new Error("Repayment months must be a positive whole number.");

      const { error } = await supabase.from("loans").insert({
        member_id: memberId,
        loan_type: loanType,
        amount: parsedAmount,
        purpose: loanNotes.trim()
          ? `${loanPurpose.trim()}\n\nOfficer note: ${loanNotes.trim()}`
          : loanPurpose.trim(),
        repayment_months: months,
        status: "submitted",
        entered_by: user.id,
        entered_by_role: currentRole,
        on_behalf_of: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Loan request logged on behalf of member.");
      setLoanOpen(false);
      setLoanType("project");
      setLoanAmount("");
      setLoanPurpose("");
      setLoanMonths("6");
      setLoanNotes("");
      qc.invalidateQueries({ queryKey: ["member-profile-loans", memberId] });
      qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!canView) {
    return (
      <div className="text-sm text-muted-foreground">
        Only the chairman, treasurer or admin can view member profiles.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/users"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" /> Back to Users &amp; Roles
          </Link>
          <h2 className="font-serif text-2xl font-semibold text-primary">
            {isLoading ? "Loading…" : (profile?.full_name ?? "Member Profile")}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {profile && (
              <>
                <Badge className={statusBadgeClass(profile.status)}>{profile.status}</Badge>
                {(!profile.email || profile.phone_only_member) && (
                  <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                    Phone Only
                  </Badge>
                )}
                {roles.map((role) => (
                  <Badge key={role.role} variant="outline" className="capitalize">
                    {role.role.replace(/_/g, " ")}
                  </Badge>
                ))}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(r.isAdmin || r.isTreasurer) && (
            <Button onClick={() => setContribOpen(true)} className="gap-2">
              <PlusCircle className="h-4 w-4" /> Log Contribution
            </Button>
          )}
          {r.isFinanceOfficer && (
            <Button variant="outline" onClick={() => setLoanOpen(true)} className="gap-2">
              <HandCoins className="h-4 w-4" /> Log Loan
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact &amp; Consent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Phone</span>
              <span className="font-medium">{profile?.phone_number ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{profile?.email ?? "None (phone only)"}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Joined</span>
              <span className="font-medium">{dateLabel(profile?.created_at)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">WhatsApp opt-in</span>
              <span className="font-medium">{profile?.whatsapp_opt_in ? "Yes" : "No"}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> KDPA consent
              </span>
              <span className="text-right font-medium">
                {profile?.consent_given ? "Given" : "Not recorded"}
                {profile?.consent_purpose ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {profile.consent_purpose}
                  </span>
                ) : null}
                {profile?.data_retention_until ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    Retained until {dateLabel(profile.data_retention_until)}
                  </span>
                ) : null}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Financial Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" /> Contributions
              </span>
              <span className="font-medium">{fmt(totalContributions)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Confirmed count</span>
              <span className="font-medium">{confirmedContribs.length}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Latest contribution</span>
              <span className="font-medium">{dateLabel(latestContribution)}</span>
            </div>
            <div className="mt-2 border-t pt-2" />
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Total loans</span>
              <span className="font-medium">{fmt(totalLoans)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Active loans</span>
              <span className="font-medium">{activeLoans.length}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Repaid</span>
              <span className="font-medium">{fmt(totalRepaid)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Outstanding</span>
              <span className="font-medium">{fmt(outstanding)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> Next due
              </span>
              <span className="font-medium">
                {nextDue
                  ? `${fmt(Number(nextDue.amount_due))} on ${dateLabel(nextDue.due_date)}`
                  : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contribution History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contributions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No contributions recorded.
                  </TableCell>
                </TableRow>
              ) : (
                contributions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{dateLabel(c.contributed_on)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {fmt(Number(c.amount))}
                    </TableCell>
                    <TableCell className="capitalize">{c.method}</TableCell>
                    <TableCell className="text-muted-foreground">{c.reference ?? "—"}</TableCell>
                    <TableCell>
                      <Badge className={statusBadgeClass(c.status)}>{c.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {c.on_behalf_of ? (
                        <Badge className="bg-amber-600 text-white hover:bg-amber-600">
                          Officer Entry
                        </Badge>
                      ) : (
                        <Badge variant="outline">Member</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Loans &amp; Repayment Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loans.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No loans recorded.</p>
          ) : (
            loans.map((loan) => {
              const schedule = repaymentsByLoan.get(loan.id) ?? [];
              const repaid = schedule.reduce((sum, rp) => sum + Number(rp.amount_paid ?? 0), 0);
              const loanOutstanding = Math.max(0, Number(loan.amount) - repaid);
              return (
                <div key={loan.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{fmt(Number(loan.amount))}</span>
                        <Badge variant="outline" className="capitalize">
                          {loan.loan_type}
                        </Badge>
                        <Badge className={statusBadgeClass(loan.status)}>{loan.status}</Badge>
                        {loan.on_behalf_of && (
                          <Badge className="bg-amber-600 text-white hover:bg-amber-600">
                            Officer Entry
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {loan.purpose} · {loan.repayment_months} months · requested{" "}
                        {dateLabel(loan.created_at)}
                      </div>
                      <div className="mt-1 text-xs">
                        Repaid {fmt(repaid)} · Outstanding {fmt(loanOutstanding)}
                      </div>
                    </div>
                    <RepaymentScheduleDialog
                      loan={loan}
                      canRecordPayment={r.isAdmin || r.isTreasurer}
                      memberEmail={profile?.email ?? undefined}
                    />
                  </div>
                  {schedule.length > 0 && (
                    <Table className="mt-3">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Due date</TableHead>
                          <TableHead className="text-right">Due</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {schedule.map((rp) => (
                          <TableRow key={rp.id}>
                            <TableCell>{rp.installment_number}</TableCell>
                            <TableCell>{dateLabel(rp.due_date)}</TableCell>
                            <TableCell className="text-right">
                              {fmt(Number(rp.amount_due))}
                            </TableCell>
                            <TableCell className="text-right">
                              {fmt(Number(rp.amount_paid ?? 0))}
                            </TableCell>
                            <TableCell>
                              <Badge className={statusBadgeClass(rp.status)}>{rp.status}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* ── Quick action: log contribution ───────── */}
      <Dialog open={contribOpen} onOpenChange={setContribOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              logContribution.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Log Contribution for {profile?.full_name ?? "Member"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-contrib-amount">Amount (KES) *</Label>
                  <Input
                    id="profile-contrib-amount"
                    type="number"
                    min="1"
                    value={contribAmount}
                    onChange={(e) => setContribAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-contrib-date">Date *</Label>
                  <Input
                    id="profile-contrib-date"
                    type="date"
                    value={contribDate}
                    onChange={(e) => setContribDate(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-contrib-ref">M-Pesa Ref *</Label>
                  <Input
                    id="profile-contrib-ref"
                    placeholder="e.g. QWE123456"
                    value={contribRef}
                    onChange={(e) => setContribRef(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-contrib-method">Method</Label>
                  <Select value={contribMethod} onValueChange={setContribMethod}>
                    <SelectTrigger id="profile-contrib-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mpesa">M-Pesa</SelectItem>
                      <SelectItem value="bank">Bank</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-contrib-notes">Notes (optional)</Label>
                <Textarea
                  id="profile-contrib-notes"
                  rows={2}
                  value={contribNotes}
                  onChange={(e) => setContribNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setContribOpen(false)}
                disabled={logContribution.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={logContribution.isPending}>
                {logContribution.isPending ? "Logging…" : "Log Contribution"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Quick action: log loan ───────── */}
      <Dialog open={loanOpen} onOpenChange={setLoanOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              logLoan.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Log Loan for {profile?.full_name ?? "Member"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-loan-type">Loan Type *</Label>
                  <Select
                    value={loanType}
                    onValueChange={(v: "project" | "emergency") => setLoanType(v)}
                  >
                    <SelectTrigger id="profile-loan-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project">Project</SelectItem>
                      <SelectItem value="emergency">Emergency</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-loan-amount">Amount (KES) *</Label>
                  <Input
                    id="profile-loan-amount"
                    type="number"
                    min="1"
                    value={loanAmount}
                    onChange={(e) => setLoanAmount(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-loan-purpose">Purpose *</Label>
                <Textarea
                  id="profile-loan-purpose"
                  rows={3}
                  value={loanPurpose}
                  onChange={(e) => setLoanPurpose(e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-loan-months">Repayment Months *</Label>
                  <Input
                    id="profile-loan-months"
                    type="number"
                    min="1"
                    step="1"
                    value={loanMonths}
                    onChange={(e) => setLoanMonths(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-loan-notes">Officer Notes (optional)</Label>
                <Textarea
                  id="profile-loan-notes"
                  rows={2}
                  value={loanNotes}
                  onChange={(e) => setLoanNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLoanOpen(false)}
                disabled={logLoan.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={logLoan.isPending}>
                {logLoan.isPending ? "Logging…" : "Log Loan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
