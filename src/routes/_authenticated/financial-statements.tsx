import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Printer,
  FileSpreadsheet,
  Landmark,
  Calendar,
  Leaf,
  PiggyBank,
  CalendarCheck,
  Users,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { UnauthorizedCard } from "@/components/shared/UnauthorizedCard";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/financial-statements")({
  component: FinancialStatementsPage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);

const PAYBILL = "522522";
const ACCOUNT = "7989164";
const BANK = "KCB Bank Kenya";

const monthKey = (d: string) => d.slice(0, 7); // YYYY-MM
const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString("en-KE", { month: "long", year: "numeric" });

const rateTone = (rate: number) =>
  rate >= 90
    ? { cls: "text-emerald-700", icon: "✅" }
    : rate >= 50
      ? { cls: "text-amber-600", icon: "⚠️" }
      : { cls: "text-rose-600", icon: "❌" };

function Row({
  label,
  value,
  indent,
  bold,
  tone,
}: {
  label: string;
  value: string;
  indent?: boolean;
  bold?: boolean;
  tone?: string;
}) {
  return (
    <div
      className={`flex justify-between gap-4 py-1 text-xs ${indent ? "pl-4" : ""} ${bold ? "font-bold" : ""}`}
    >
      <span>{label}</span>
      <span className={`font-mono text-right ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b pb-1">
      <h2 className="font-serif text-lg font-bold text-primary uppercase tracking-wide">
        {children}
      </h2>
    </div>
  );
}

interface LoanRepaymentItem {
  id: string;
  amount_due: number;
  amount_paid: number | null;
  status: string;
  payment_status: string;
  due_date: string;
  paid_at: string | null;
  payment_method: string | null;
}
interface LoanItem {
  id: string;
  amount: number;
  status: string;
  loan_type: "project" | "emergency";
  member_id: string;
  created_at: string;
  decision_at: string | null;
  repayment_months: number;
  loan_repayments: LoanRepaymentItem[] | null;
}

const loanPaid = (l: LoanItem) =>
  (l.loan_repayments ?? []).reduce((s, r) => s + Number(r.amount_paid ?? 0), 0);
const loanScheduled = (l: LoanItem) =>
  (l.loan_repayments ?? []).reduce((s, r) => s + Number(r.amount_due), 0);
const loanOutstanding = (l: LoanItem) => {
  if (l.status === "completed") return 0;
  const scheduled = loanScheduled(l);
  const base = scheduled > 0 ? scheduled : Number(l.amount);
  return Math.max(0, base - loanPaid(l));
};

function FinancialStatementsPage() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<string>(String(currentYear));
  const [periodType, setPeriodType] = useState<string>("Q3"); // Q1, Q2, Q3, Q4, ANNUAL

  // Fetch all transactions
  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ["transactions", "statement"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, donors(name)")
        .order("occurred_on", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch all loans & repayments
  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ["loans", "statement"],
    queryFn: async () => {
      const { data, error } = await supabase.from("loans").select(`
        id,
        amount,
        status,
        loan_type,
        member_id,
        created_at,
        decision_at,
        repayment_months,
        loan_repayments (
          id,
          amount_due,
          amount_paid,
          status,
          payment_status,
          due_date,
          paid_at,
          payment_method
        )
      `);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch confirmed member contributions
  const { data: contributions = [], isLoading: contribsLoading } = useQuery({
    queryKey: ["contributions", "statement"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .select("id, amount, status, contributed_on, member_id, method")
        .eq("status", "confirmed");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Approved members
  const { data: members = [] } = useQuery({
    queryKey: ["members", "statement"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, status, created_at")
        .eq("status", "approved");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (r.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  if (!r.isAdmin && !r.isTreasurer && !r.isChairman) {
    return <UnauthorizedCard message="This page is restricted to officers." />;
  }

  // Date boundary calculation for selected period
  const yr = parseInt(selectedYear, 10);
  let startDate: Date;
  let endDate: Date;
  let periodLabel: string;

  if (periodType === "Q1") {
    startDate = new Date(yr, 0, 1);
    endDate = new Date(yr, 2, 31, 23, 59, 59);
    periodLabel = `First Quarter (January 1 - March 31, ${yr})`;
  } else if (periodType === "Q2") {
    startDate = new Date(yr, 3, 1);
    endDate = new Date(yr, 5, 30, 23, 59, 59);
    periodLabel = `Second Quarter (April 1 - June 30, ${yr})`;
  } else if (periodType === "Q3") {
    startDate = new Date(yr, 6, 1);
    endDate = new Date(yr, 8, 30, 23, 59, 59);
    periodLabel = `Third Quarter (July 1 - September 30, ${yr})`;
  } else if (periodType === "Q4") {
    startDate = new Date(yr, 9, 1);
    endDate = new Date(yr, 11, 31, 23, 59, 59);
    periodLabel = `Fourth Quarter (October 1 - December 31, ${yr})`;
  } else {
    startDate = new Date(yr, 0, 1);
    endDate = new Date(yr, 11, 31, 23, 59, 59);
    periodLabel = `Annual Statement (January 1 - December 31, ${yr})`;
  }

  const inPeriod = (d: string | null | undefined) => {
    if (!d) return false;
    const dt = new Date(d.length === 10 ? `${d}T00:00:00` : d);
    return dt >= startDate && dt <= endDate;
  };
  const datePrepared = new Date().toLocaleDateString("en-KE", { dateStyle: "long" });

  // ─── Loan portfolio (all time, as at today) ───────────────────────────
  const typedLoans = loans as LoanItem[];
  const today = new Date().toISOString().split("T")[0];
  const disbursedLoans = typedLoans.filter((l) => ["approved", "completed"].includes(l.status));
  const activeLoans = typedLoans.filter((l) => l.status === "approved");
  const completedLoans = typedLoans.filter((l) => l.status === "completed");
  const projectLoans = disbursedLoans.filter((l) => l.loan_type === "project");
  const emergencyLoans = disbursedLoans.filter((l) => l.loan_type === "emergency");
  const sumAmount = (ls: LoanItem[]) => ls.reduce((s, l) => s + Number(l.amount), 0);
  const totalDisbursed = sumAmount(disbursedLoans);
  const activePortfolio = sumAmount(activeLoans);
  const completedPortfolio = sumAmount(completedLoans);
  const totalRepaid = disbursedLoans.reduce((s, l) => s + loanPaid(l), 0);
  // Outstanding = scheduled amount still owed (principal + interest); completed loans owe 0
  const outstandingBalance = disbursedLoans.reduce((s, l) => s + loanOutstanding(l), 0);
  const parAmount = activeLoans.reduce(
    (sum, l) =>
      sum +
      (l.loan_repayments ?? []).reduce((s, r) => {
        const paid = Number(r.amount_paid ?? 0);
        const due = Number(r.amount_due);
        return r.due_date < today && paid < due ? s + (due - paid) : s;
      }, 0),
    0,
  );
  const parRatioNum = activePortfolio > 0 ? (parAmount / activePortfolio) * 100 : 0;
  const parRatio = parRatioNum.toFixed(2);
  const parHealthy = parRatioNum < 5;
  const totalDueSoFar = disbursedLoans.reduce(
    (sum, l) =>
      sum +
      (l.loan_repayments ?? []).reduce(
        (s, r) => (r.due_date <= today ? s + Number(r.amount_due) : s),
        0,
      ),
    0,
  );
  const collectionRate =
    totalDueSoFar > 0 ? Math.min(100, (totalRepaid / totalDueSoFar) * 100).toFixed(1) : "100.0";

  const loanDate = (l: LoanItem) => l.decision_at ?? l.created_at;
  const periodDisbursedLoans = disbursedLoans.filter((l) => inPeriod(loanDate(l)));
  const periodDisbursed = sumAmount(periodDisbursedLoans);

  // Interest received: each payment is split pro-rata between principal and interest
  // using the loan's schedule (interest share = (scheduled - principal) / scheduled).
  const interestShare = (l: LoanItem) => {
    const scheduled = loanScheduled(l);
    return scheduled > Number(l.amount) ? (scheduled - Number(l.amount)) / scheduled : 0;
  };
  const periodInterest = disbursedLoans.reduce(
    (sum, l) =>
      sum +
      (l.loan_repayments ?? [])
        .filter((r) => inPeriod(r.paid_at ?? r.due_date))
        .reduce((s, r) => s + Number(r.amount_paid ?? 0) * interestShare(l), 0),
    0,
  );

  // ─── Contributions ─────────────────────────────────────────────────────
  const allContribTotal = contributions.reduce((s, c) => s + Number(c.amount), 0);
  const periodContribs = contributions.filter((c) => inPeriod(c.contributed_on));
  const memberContribTotal = periodContribs.reduce((s, c) => s + Number(c.amount), 0);
  const contributingMembers = new Set(contributions.map((c) => c.member_id));
  const periodContributingMembers = new Set(periodContribs.map((c) => c.member_id));
  const avgPerMember =
    contributingMembers.size > 0 ? allContribTotal / contributingMembers.size : 0;
  const contribByMonth = new Map<string, { n: number; amount: number }>();
  periodContribs.forEach((c) => {
    const k = monthKey(c.contributed_on);
    const cur = contribByMonth.get(k) ?? { n: 0, amount: 0 };
    contribByMonth.set(k, { n: cur.n + 1, amount: cur.amount + Number(c.amount) });
  });
  const contribMonths = Array.from(contribByMonth.entries()).sort(([a], [b]) => a.localeCompare(b));

  // ─── Repayment performance (by due month, within period) ─────────────
  const repByMonth = new Map<string, { due: number; collected: number; overdue: number }>();
  disbursedLoans.forEach((l) =>
    (l.loan_repayments ?? []).forEach((r) => {
      if (!inPeriod(r.due_date)) return;
      const k = monthKey(r.due_date);
      const due = Number(r.amount_due);
      const paid = Number(r.amount_paid ?? 0);
      const cur = repByMonth.get(k) ?? { due: 0, collected: 0, overdue: 0 };
      repByMonth.set(k, {
        due: cur.due + due,
        collected: cur.collected + paid,
        overdue: cur.overdue + (r.due_date < today && paid < due ? due - paid : 0),
      });
    }),
  );
  const repMonths = Array.from(repByMonth.entries()).sort(([a], [b]) => a.localeCompare(b));

  // ─── Member statistics ────────────────────────────────────────────────
  const membersWithActive = new Set(activeLoans.map((l) => l.member_id)).size;
  const membersWithCompleted = new Set(completedLoans.map((l) => l.member_id)).size;
  const newMembers = members.filter((m) => inPeriod(m.created_at)).length;

  // ─── Income & expenditure (period) ────────────────────────────────────
  const periodTxs = transactions.filter((t) => inPeriod(t.occurred_on));
  const cat = (c: string) => c.toLowerCase();
  const isGrant = (c: string) => /grant|donation|donor/.test(cat(c));
  const isBank = (c: string) => /bank/.test(cat(c));
  const isAdmin = (c: string) => /admin/.test(cat(c));
  const sumTx = (ts: typeof transactions) => ts.reduce((s, t) => s + Number(t.amount), 0);

  const incomeTxs = periodTxs.filter((t) => t.type === "income");
  const grantsIncome = sumTx(incomeTxs.filter((t) => isGrant(t.category)));
  const otherIncome = sumTx(incomeTxs.filter((t) => !isGrant(t.category)));
  const totalIncome = memberContribTotal + periodInterest + grantsIncome + otherIncome;

  const expenseTxs = periodTxs.filter((t) => t.type === "expense");
  const adminExp = sumTx(expenseTxs.filter((t) => isAdmin(t.category)));
  const bankExp = sumTx(expenseTxs.filter((t) => isBank(t.category)));
  const otherExpTxs = expenseTxs.filter((t) => !isAdmin(t.category) && !isBank(t.category));
  const otherExp = sumTx(otherExpTxs);
  const otherExpBreakdown = new Map<string, number>();
  otherExpTxs.forEach((t) =>
    otherExpBreakdown.set(t.category, (otherExpBreakdown.get(t.category) ?? 0) + Number(t.amount)),
  );
  const totalExpenditure = adminExp + bankExp + otherExp;
  const netSurplus = totalIncome - totalExpenditure;

  // ─── Fund position (cumulative, as at today) ─────────────────────────
  const allIncomeTxs = transactions.filter((t) => t.type === "income");
  const allExpenseTxs = transactions.filter((t) => t.type === "expense");
  const fpGrants = sumTx(allIncomeTxs.filter((t) => isGrant(t.category)));
  const fpOther = sumTx(allIncomeTxs.filter((t) => !isGrant(t.category)));
  const fpReceived = allContribTotal + fpGrants + fpOther;
  const fpAdmin = sumTx(allExpenseTxs.filter((t) => isAdmin(t.category)));
  const fpOtherExp = sumTx(allExpenseTxs.filter((t) => !isAdmin(t.category)));
  const fpUsed = totalDisbursed + fpAdmin + fpOtherExp;
  const liquidCash =
    allContribTotal + totalRepaid + fpGrants + fpOther - totalDisbursed - fpAdmin - fpOtherExp;
  const totalAssets = liquidCash + outstandingBalance;

  const handlePrint = () => {
    window.print();
  };

  const isLoading = txLoading || loansLoading || contribsLoading;
  const neg = (n: number) => `(${fmt(n)})`;

  return (
    <div className="space-y-6 financial-statement-page">
      {/* Action / Selector Bar (Hidden on print) */}
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 print:hidden md:flex-row md:items-center md:justify-between shadow-sm">
        <div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-primary" />
            Board Financial Statements
          </h1>
          <p className="text-xs text-muted-foreground">
            Generate formal, presentation-ready financial statements for board meetings and
            governance review.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-28 h-9 text-xs">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  Year {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={periodType} onValueChange={setPeriodType}>
            <SelectTrigger className="w-36 h-9 text-xs">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Q1">Q1 (Jan - Mar)</SelectItem>
              <SelectItem value="Q2">Q2 (Apr - Jun)</SelectItem>
              <SelectItem value="Q3">Q3 (Jul - Sep)</SelectItem>
              <SelectItem value="Q4">Q4 (Oct - Dec)</SelectItem>
              <SelectItem value="ANNUAL">Full Year Statement</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={handlePrint} className="h-9 gap-1.5 text-xs bg-primary">
            <Printer className="h-3.5 w-3.5" /> Print / Export Board PDF
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="text-center text-xs text-muted-foreground print:hidden">
          Loading financial data…
        </div>
      )}

      {/* Print-only running header */}
      <div className="print-running-header hidden print:flex">
        <span>MURAGE FOUNDATION — Financial Statement - {periodLabel}</span>
        <span className="font-bold tracking-widest">CONFIDENTIAL</span>
      </div>

      {/* Formal Printable Document */}
      <div className="statement-doc mx-auto max-w-4xl bg-white p-8 md:p-12 border rounded-lg shadow-sm print:border-none print:shadow-none print:p-0 print:max-w-none text-slate-800">
        {/* Header Block */}
        <div className="border-b-2 border-primary pb-6 mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Leaf className="h-7 w-7 text-gold" />
          </div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-primary">
            MURAGE FOUNDATION
          </h1>
          <p className="text-xs tracking-widest uppercase font-semibold text-gold mt-1">
            Financial Statement - {periodLabel}
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1 text-xs font-medium text-slate-700">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <span>
              Reporting Period: <strong>{periodLabel}</strong>
            </span>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Date Prepared: {datePrepared} • Currency: Kenyan Shillings (KES) • Prepared for the
            Board of Directors
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {BANK} • Paybill: {PAYBILL} • Account: {ACCOUNT}
          </div>
        </div>

        {/* I. Income & Expenditure */}
        <section className="statement-section space-y-4 mb-8">
          <SectionTitle>I. Statement of Income & Expenditure</SectionTitle>

          <Table className="text-xs">
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="font-bold text-slate-800">Income</TableHead>
                <TableHead className="w-40 text-right font-bold text-slate-800">
                  Amount (KES)
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="pl-4">Member Contributions</TableCell>
                <TableCell className="text-right font-mono">{fmt(memberContribTotal)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4">Loan Interest Received</TableCell>
                <TableCell className="text-right font-mono">{fmt(periodInterest)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4">Donor Grants</TableCell>
                <TableCell className="text-right font-mono">{fmt(grantsIncome)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4">Other Income</TableCell>
                <TableCell className="text-right font-mono">{fmt(otherIncome)}</TableCell>
              </TableRow>
              <TableRow className="bg-emerald-50/50 font-bold border-t-2 border-emerald-600">
                <TableCell className="text-emerald-950">TOTAL INCOME</TableCell>
                <TableCell className="text-right font-mono text-emerald-700 font-bold text-sm">
                  {fmt(totalIncome)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <Table className="text-xs mt-4">
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="font-bold text-slate-800">Expenditure</TableHead>
                <TableHead className="w-40 text-right font-bold text-slate-800">
                  Amount (KES)
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="pl-4">Administrative</TableCell>
                <TableCell className="text-right font-mono">{fmt(adminExp)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4">Bank Charges</TableCell>
                <TableCell className="text-right font-mono">{fmt(bankExp)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4">Other Expenses</TableCell>
                <TableCell className="text-right font-mono">{fmt(otherExp)}</TableCell>
              </TableRow>
              {Array.from(otherExpBreakdown.entries()).map(([c, amt]) => (
                <TableRow key={c}>
                  <TableCell className="pl-8 text-muted-foreground">↳ {c}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {fmt(amt)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-slate-100 font-bold border-t-2 border-slate-400">
                <TableCell className="text-slate-900">TOTAL EXPENDITURE</TableCell>
                <TableCell className="text-right font-mono text-slate-900 font-bold text-sm">
                  {fmt(totalExpenditure)}
                </TableCell>
              </TableRow>
              <TableRow
                className={`font-bold border-y-4 border-double ${netSurplus >= 0 ? "bg-emerald-100/70 border-emerald-700" : "bg-rose-100/70 border-rose-700"}`}
              >
                <TableCell className="text-base font-serif">
                  {netSurplus >= 0 ? "NET SURPLUS" : "NET (DEFICIT)"}
                </TableCell>
                <TableCell
                  className={`text-right font-mono font-bold text-base ${netSurplus >= 0 ? "text-emerald-800" : "text-rose-800"}`}
                >
                  {netSurplus >= 0 ? fmt(netSurplus) : neg(Math.abs(netSurplus))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="text-[10px] text-muted-foreground">
            Loan interest is the interest portion of repayments received in the period, allocated
            pro-rata from each loan&apos;s repayment schedule.
          </p>
        </section>

        {/* II. Loan Portfolio */}
        <section className="statement-section space-y-4 mb-8">
          <SectionTitle>II. Loan Portfolio</SectionTitle>
          <Card className={`border-2 ${parHealthy ? "border-emerald-500" : "border-rose-500"}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-primary" /> Loan Portfolio Summary
                </span>
                <Badge
                  className={
                    parHealthy
                      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                      : "bg-rose-100 text-rose-800 hover:bg-rose-100"
                  }
                >
                  {parHealthy ? "Healthy" : "At Risk"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Row label="Total Ever Disbursed" value={fmt(totalDisbursed)} bold />
              <Row label="Disbursed This Period" value={fmt(periodDisbursed)} />
              <SubHead>By Type</SubHead>
              <Row
                indent
                label={`Project Loans (${projectLoans.length})`}
                value={fmt(sumAmount(projectLoans))}
              />
              <Row
                indent
                label={`Emergency Loans (${emergencyLoans.length})`}
                value={fmt(sumAmount(emergencyLoans))}
              />
              <SubHead>By Status</SubHead>
              <Row
                indent
                label={`Active Loans (${activeLoans.length})`}
                value={fmt(activePortfolio)}
              />
              <Row
                indent
                label={`Completed Loans (${completedLoans.length})`}
                value={fmt(completedPortfolio)}
              />
              <SubHead>Repayment Position</SubHead>
              <Row indent label="Total Repaid" value={fmt(totalRepaid)} />
              <Row indent label="Outstanding Balance" value={fmt(outstandingBalance)} />
              <SubHead>Performance</SubHead>
              <Row indent label="Collection Rate" value={`${collectionRate}%`} />
              <Row
                indent
                label="Portfolio at Risk"
                value={fmt(parAmount)}
                tone={parAmount > 0 ? "text-rose-600" : "text-emerald-700"}
              />
              <Row
                indent
                label="PAR Ratio"
                value={`${parRatio}%`}
                tone={parHealthy ? "text-emerald-700" : "text-rose-600"}
              />
              <p className="mt-2 text-[10px] text-muted-foreground">
                Portfolio figures are cumulative as at {datePrepared}. Outstanding balance includes
                scheduled interest.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* III. Repayment Performance */}
        <section className="statement-section space-y-4 mb-8">
          <SectionTitle>III. Monthly Repayment Performance</SectionTitle>
          <Table className="text-xs">
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="font-bold text-slate-800">
                  <CalendarCheck className="inline h-3.5 w-3.5 mr-1" />
                  Month
                </TableHead>
                <TableHead className="text-right font-bold text-slate-800">Due</TableHead>
                <TableHead className="text-right font-bold text-slate-800">Collected</TableHead>
                <TableHead className="text-right font-bold text-slate-800">Rate</TableHead>
                <TableHead className="text-right font-bold text-slate-800">Overdue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repMonths.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-4 text-center text-muted-foreground italic">
                    No repayments fall due in this period.
                  </TableCell>
                </TableRow>
              ) : (
                repMonths.map(([k, v]) => {
                  const rate = v.due > 0 ? Math.min(100, (v.collected / v.due) * 100) : 100;
                  const tone = rateTone(rate);
                  return (
                    <TableRow key={k}>
                      <TableCell>{monthLabel(k)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(v.due)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(v.collected)}</TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${tone.cls}`}>
                        {rate.toFixed(0)}% {tone.icon}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${v.overdue > 0 ? "text-rose-600" : ""}`}
                      >
                        {fmt(v.overdue)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </section>

        {/* IV. Member Savings & Statistics */}
        <section className="statement-section space-y-4 mb-8">
          <SectionTitle>IV. Members & Savings</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PiggyBank className="h-4 w-4 text-primary" /> Member Savings Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Row label="Total Contributions (all time)" value={fmt(allContribTotal)} bold />
                <Row label="Contributions This Period" value={fmt(memberContribTotal)} />
                <Row label="Number of Contributions" value={String(contributions.length)} />
                <Row label="Contributing Members" value={String(contributingMembers.size)} />
                <Row label="Average per Member" value={fmt(avgPerMember)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-primary" /> Member Statistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Row label="Total Approved Members" value={String(members.length)} bold />
                <Row label="Members With Active Loans" value={String(membersWithActive)} />
                <Row label="Members With Completed Loans" value={String(membersWithCompleted)} />
                <Row
                  label="Members Who Contributed (period)"
                  value={String(periodContributingMembers.size)}
                />
                <Row label="New Members This Period" value={String(newMembers)} />
              </CardContent>
            </Card>
          </div>

          <Table className="text-xs">
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="font-bold text-slate-800">Month</TableHead>
                <TableHead className="text-right font-bold text-slate-800">Contributions</TableHead>
                <TableHead className="text-right font-bold text-slate-800">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contribMonths.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-4 text-center text-muted-foreground italic">
                    No confirmed contributions in this period.
                  </TableCell>
                </TableRow>
              ) : (
                contribMonths.map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell>{monthLabel(k)}</TableCell>
                    <TableCell className="text-right font-mono">{v.n}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(v.amount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>

        {/* V. Fund Position */}
        <section className="statement-section space-y-4 mb-8">
          <SectionTitle>V. Fund Position (Balance Sheet)</SectionTitle>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="h-4 w-4 text-primary" /> Fund Position as at {datePrepared}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SubHead>Sources of Funds</SubHead>
              <Row indent label="Member Contributions" value={fmt(allContribTotal)} />
              <Row indent label="Donor Grants" value={fmt(fpGrants)} />
              <Row indent label="Other Income" value={fmt(fpOther)} />
              <Row indent bold label="Total Funds Received" value={fmt(fpReceived)} />
              <SubHead>Use of Funds</SubHead>
              <Row indent label="Loans Disbursed" value={neg(totalDisbursed)} />
              <Row indent label="Administrative Costs" value={neg(fpAdmin)} />
              <Row indent label="Other Expenses" value={neg(fpOtherExp)} />
              <Row indent bold label="Total Funds Used" value={fmt(fpUsed)} />
              <SubHead>Assets</SubHead>
              <Row
                indent
                label="Liquid Cash / Bank"
                value={liquidCash >= 0 ? fmt(liquidCash) : neg(Math.abs(liquidCash))}
                tone={liquidCash < 0 ? "text-rose-600" : ""}
              />
              <Row indent label="Loan Portfolio (outstanding)" value={fmt(outstandingBalance)} />
              <div className="border-t-2 border-double border-slate-400 mt-1" />
              <Row bold label="TOTAL ASSETS" value={fmt(totalAssets)} />
              <p className="mt-3 text-[10px] text-muted-foreground">
                Liquid Cash = contributions received + loan repayments received + grants & other
                income − loans disbursed − expenses paid ({BANK}, Account {ACCOUNT}).
              </p>
            </CardContent>
          </Card>
        </section>

        {/* VI. Statutory Section */}
        <section className="statement-section border-t-2 border-slate-200 pt-6 mt-12">
          <h3 className="font-serif text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 text-center flex items-center justify-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Statutory Certification & Sign-off
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-xs mb-4 print:grid-cols-2">
            <Row label="Foundation Name" value="MURAGE FOUNDATION" />
            <Row label="Report Period" value={periodLabel} />
            <Row label="Date Prepared" value={datePrepared} />
            <Row label="Payment Details" value={`Paybill: ${PAYBILL} | Account: ${ACCOUNT}`} />
          </div>

          <p className="text-xs italic leading-relaxed text-slate-700 border-l-4 border-primary pl-3 mb-8">
            &ldquo;We, the undersigned officers of Murage Foundation, hereby certify that the
            financial statements presented herein are true and accurate records of the
            Foundation&apos;s financial position for the period stated, prepared in accordance with
            the Kenya Data Protection Act 2019 and applicable financial regulations.&rdquo;
          </p>

          <div className="grid grid-cols-2 gap-12 text-xs">
            {["TREASURER", "CHAIRMAN"].map((role) => (
              <div key={role} className="space-y-4">
                <p className="font-bold text-slate-900">{role}:</p>
                {["Name", "Signature", "Date"].map((f) => (
                  <div key={f} className="flex items-end gap-2">
                    <span className="w-16 text-muted-foreground">{f}:</span>
                    <span className="flex-1 border-b border-slate-400 h-5" />
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-3 text-xs">
            <span className="font-semibold">Foundation Official Seal:</span>
            <span className="inline-block h-20 w-32 border-2 border-dashed border-slate-400" />
          </div>

          <div className="mt-8 text-center text-[10px] text-muted-foreground border-t pt-4">
            Murage Foundation • {BANK} • Paybill: {PAYBILL} • Account: {ACCOUNT} • Report Generated:{" "}
            {datePrepared}
          </div>
        </section>
      </div>

      {/* Print-only running footer */}
      <div className="print-running-footer hidden print:block">
        MURAGE FOUNDATION • {BANK} • Paybill: {PAYBILL} • Account: {ACCOUNT} • Prepared{" "}
        {datePrepared}
      </div>
    </div>
  );
}
