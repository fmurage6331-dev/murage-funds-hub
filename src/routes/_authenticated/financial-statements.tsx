import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
  Download,
  FileSpreadsheet,
  Landmark,
  Calendar,
  Leaf,
  CheckCircle2,
} from "lucide-react";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/financial-statements")({
  component: FinancialStatementsPage,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

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
      const { data, error } = await supabase.from("loans").select("*, loan_repayments(*)");
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
        .select("*")
        .eq("status", "confirmed");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!r.canViewFinancials) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Access restricted to authorized officers.
      </div>
    );
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

  // Filter transactions within period
  const periodTxs = transactions.filter((t) => {
    const d = new Date(t.occurred_on);
    return d >= startDate && d <= endDate;
  });

  // Filter member contributions in period
  const periodContribs = contributions.filter((c) => {
    const d = new Date(c.contributed_on);
    return d >= startDate && d <= endDate;
  });

  // Inflow categories
  const memberContribTotal = periodContribs.reduce((sum, c) => sum + Number(c.amount), 0);
  const incomeTxs = periodTxs.filter((t) => t.type === "income");

  const grantsAndDonations = incomeTxs
    .filter((t) => ["Donation", "Grant"].includes(t.category))
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const fundraisers = incomeTxs
    .filter((t) => t.category === "Fundraiser")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const interestAndOtherIncome = incomeTxs
    .filter((t) => !["Donation", "Grant", "Fundraiser"].includes(t.category))
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalInflows =
    memberContribTotal + grantsAndDonations + fundraisers + interestAndOtherIncome;

  // Outflow / Expense categories
  const expenseTxs = periodTxs.filter((t) => t.type === "expense");
  const expenseBreakdown = new Map<string, number>();
  let totalExpenses = 0;

  expenseTxs.forEach((t) => {
    const amt = Number(t.amount);
    expenseBreakdown.set(t.category, (expenseBreakdown.get(t.category) || 0) + amt);
    totalExpenses += amt;
  });

  const netSurplus = totalInflows - totalExpenses;

  // Active Loan Portfolio Stats
  interface LoanRepaymentItem {
    amount_paid: number | null;
    amount_due: number;
    due_date: string;
  }
  interface LoanItem {
    id: string;
    amount: number;
    status: string;
    loan_repayments?: LoanRepaymentItem[];
  }

  const typedLoans = loans as unknown as LoanItem[];
  const approvedLoans = typedLoans.filter((l) => l.status === "approved");
  const totalLoanPrincipalDisbursed = approvedLoans.reduce((sum, l) => sum + Number(l.amount), 0);

  let totalRepaidAcrossAllLoans = 0;
  let totalOverdueBalance = 0;

  approvedLoans.forEach((l) => {
    const reps = l.loan_repayments || [];
    reps.forEach((r) => {
      totalRepaidAcrossAllLoans += Number(r.amount_paid || 0);
      if (new Date(r.due_date) < new Date() && Number(r.amount_paid || 0) < Number(r.amount_due)) {
        totalOverdueBalance += Number(r.amount_due) - Number(r.amount_paid || 0);
      }
    });
  });

  const outstandingLoanPortfolio = Math.max(
    0,
    totalLoanPrincipalDisbursed - totalRepaidAcrossAllLoans,
  );

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
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

      {/* Formal Printable Document */}
      <div className="mx-auto max-w-4xl bg-white p-8 md:p-12 border rounded-lg shadow-sm print:border-none print:shadow-none print:p-0 text-slate-800">
        {/* Header Block */}
        <div className="border-b-2 border-primary pb-6 mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Leaf className="h-7 w-7 text-gold" />
          </div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-primary">
            MURAGE FOUNDATION
          </h1>
          <p className="text-xs tracking-widest uppercase font-semibold text-gold mt-1">
            Financial Stewardship & Governance Report
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1 text-xs font-medium text-slate-700">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <span>
              Reporting Period: <strong>{periodLabel}</strong>
            </span>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Currency: Kenyan Shillings (KES) • Prepared for the Board of Directors
          </div>
        </div>

        {/* Section 1: Statement of Comprehensive Inflows & Operating Expenses */}
        <div className="space-y-4 mb-8">
          <div className="border-b pb-1">
            <h2 className="font-serif text-lg font-bold text-primary uppercase tracking-wide">
              I. Statement of Financial Activities (Income & Expenditure)
            </h2>
          </div>

          <Table className="text-xs">
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="font-bold text-slate-800">Revenue & Inflows</TableHead>
                <TableHead className="w-36 text-right font-bold text-slate-800">
                  Amount (KES)
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="pl-4">Member Contributions (Verified & Confirmed)</TableCell>
                <TableCell className="text-right font-mono">{fmt(memberContribTotal)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4">
                  Institutional Grants & Philanthropic Donations
                </TableCell>
                <TableCell className="text-right font-mono">{fmt(grantsAndDonations)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4">Fundraising Campaigns & Special Events</TableCell>
                <TableCell className="text-right font-mono">{fmt(fundraisers)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4">Interest Earned & Miscellaneous Receipts</TableCell>
                <TableCell className="text-right font-mono">
                  {fmt(interestAndOtherIncome)}
                </TableCell>
              </TableRow>
              <TableRow className="bg-emerald-50/50 font-bold border-t-2 border-emerald-600">
                <TableCell className="text-emerald-950">TOTAL INFLOWS</TableCell>
                <TableCell className="text-right font-mono text-emerald-700 font-bold text-sm">
                  {fmt(totalInflows)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <Table className="text-xs mt-4">
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="font-bold text-slate-800">
                  Operational & Program Expenses
                </TableHead>
                <TableHead className="w-36 text-right font-bold text-slate-800">
                  Amount (KES)
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenseBreakdown.size === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-4 text-center text-muted-foreground italic">
                    No operating expenses logged in this period.
                  </TableCell>
                </TableRow>
              ) : (
                Array.from(expenseBreakdown.entries()).map(([cat, amt]) => (
                  <TableRow key={cat}>
                    <TableCell className="pl-4">{cat}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(amt)}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className="bg-slate-100 font-bold border-t-2 border-slate-400">
                <TableCell className="text-slate-900">TOTAL OPERATING EXPENSES</TableCell>
                <TableCell className="text-right font-mono text-slate-900 font-bold text-sm">
                  {fmt(totalExpenses)}
                </TableCell>
              </TableRow>
              <TableRow
                className={`font-bold border-t-2 ${netSurplus >= 0 ? "bg-emerald-100/70 border-emerald-700" : "bg-rose-100/70 border-rose-700"}`}
              >
                <TableCell className="text-base font-serif">
                  {netSurplus >= 0 ? "NET OPERATING SURPLUS" : "NET OPERATING DEFICIT"}
                </TableCell>
                <TableCell
                  className={`text-right font-mono font-bold text-base ${netSurplus >= 0 ? "text-emerald-800" : "text-rose-800"}`}
                >
                  {netSurplus >= 0 ? "+" : ""}
                  {fmt(netSurplus)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Section 2: Statement of Financial Position & Assets */}
        <div className="space-y-4 mb-8">
          <div className="border-b pb-1">
            <h2 className="font-serif text-lg font-bold text-primary uppercase tracking-wide">
              II. Portfolio Assets & Financial Position
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded border bg-slate-50 p-4">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                Liquid Net Balance
              </span>
              <div className="text-xl font-bold font-serif text-primary mt-1">
                {fmt(totalInflows - totalExpenses)}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Period operating cash buffer</p>
            </div>

            <div className="rounded border bg-slate-50 p-4">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                Outstanding Loan Assets
              </span>
              <div className="text-xl font-bold font-serif text-slate-900 mt-1">
                {fmt(outstandingLoanPortfolio)}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Total active member loans due
              </p>
            </div>

            <div className="rounded border bg-slate-50 p-4">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                Portfolio at Risk (Overdue)
              </span>
              <div
                className={`text-xl font-bold font-serif mt-1 ${totalOverdueBalance > 0 ? "text-rose-600" : "text-emerald-600"}`}
              >
                {fmt(totalOverdueBalance)}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {totalOverdueBalance > 0
                  ? "Requires recovery attention"
                  : "All payments currently up-to-date"}
              </p>
            </div>
          </div>
        </div>

        {/* Section 3: Statutory Governance & Sign-off Block */}
        <div className="border-t-2 border-slate-200 pt-6 mt-12">
          <h3 className="font-serif text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-6 text-center">
            Statutory Approval & Governance Sign-off
          </h3>

          <div className="grid grid-cols-2 gap-12 text-xs">
            <div className="space-y-6">
              <div>
                <p className="font-semibold text-slate-900">Certified by Foundation Treasurer:</p>
                <div className="border-b border-slate-400 mt-12 mb-2" />
                <div className="flex justify-between text-muted-foreground">
                  <span>Signature & Date</span>
                  <span>Official Stamp</span>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <p className="font-semibold text-slate-900">Approved by Board Chairman:</p>
                <div className="border-b border-slate-400 mt-12 mb-2" />
                <div className="flex justify-between text-muted-foreground">
                  <span>Signature & Date</span>
                  <span>Official Stamp</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 text-center text-[10px] text-muted-foreground border-t pt-4">
            Murage Foundation • Registered Welfare & Trust Organization, Kenya • Report Generated:{" "}
            {new Date().toLocaleDateString("en-KE", { dateStyle: "long" })}
          </div>
        </div>
      </div>
    </div>
  );
}
