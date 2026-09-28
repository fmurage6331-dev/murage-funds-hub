import { PaymentInfoCard } from "@/components/shared/PaymentInfoCard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useRoles } from "@/hooks/use-roles";
import { RepaymentScheduleDialog } from "@/components/loans/RepaymentScheduleDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Clock,
  Users,
  Wallet,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  HandCoins,
  Hourglass,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

type DashboardLoan = Tables<"loans"> & {
  loan_repayments: Tables<"loan_repayments">[];
};

function isRepaymentConfirmed(repayment: Tables<"loan_repayments">): boolean {
  return repayment.payment_status === "confirmed" || repayment.status === "paid";
}

function canLogRepayment(repayment: Tables<"loan_repayments">): boolean {
  return (
    (repayment.status === "pending" || repayment.status === "overdue") &&
    (repayment.payment_status === "not_paid" || repayment.payment_status === "rejected")
  );
}

function Dashboard() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const queryClient = useQueryClient();
  // Members get their own numbers only; officers see the foundation view.
  const isOfficer = r.isOfficer;
  const canReviewLoanPayments = r.isAdmin || r.isTreasurer;

  const { data: pendingLoanPayments = 0 } = useQuery({
    queryKey: ["pending-loan-payments-count"],
    enabled: canReviewLoanPayments,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("loan_repayments")
        .select("id", { count: "exact", head: true })
        .eq("payment_status", "pending_confirmation");
      if (error) throw error;
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (!canReviewLoanPayments) return;

    const channel = supabase
      .channel("dashboard-loan-payments-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loan_repayments",
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["pending-loan-payments-count"] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [canReviewLoanPayments, queryClient]);

  const { data: txs = [] } = useQuery({
    queryKey: ["transactions", "all"],
    enabled: isOfficer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .order("occurred_on", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: donorCount = 0 } = useQuery({
    queryKey: ["donors", "count"],
    enabled: isOfficer,
    queryFn: async () => {
      const { count } = await supabase.from("donors").select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: riskLoans = [] } = useQuery({
    queryKey: ["loan_risk_flags"],
    enabled: isOfficer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loan_risk_flags")
        .select("*")
        .neq("risk_tier", "healthy")
        .order("max_days_overdue", { ascending: false });
      if (error) {
        console.warn("View query fallback", error);
        return [];
      }
      return data ?? [];
    },
  });

  const { data: myContributions = [] } = useQuery({
    queryKey: ["my-contribs", user.id],
    enabled: !isOfficer,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("contributions")
          .select("*")
          .eq("member_id", user.id)
          .order("contributed_on", { ascending: false });
        if (error) throw error;
        return data ?? [];
      } catch (error) {
        console.error("Failed to load your contributions", error);
        return [];
      }
    },
  });

  const { data: myLoans = [] } = useQuery<DashboardLoan[]>({
    queryKey: ["my-loans", user.id],
    enabled: !isOfficer,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("loans")
          .select("*, loan_repayments(*)")
          .eq("member_id", user.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (data ?? []) as unknown as DashboardLoan[];
      } catch (error) {
        console.error("Failed to load your loans", error);
        return [];
      }
    },
  });

  const totalOverdue = riskLoans.reduce((sum, l) => sum + Number(l.total_overdue_amount || 0), 0);
  const criticalCount = riskLoans.filter((l) => l.risk_tier === "critical_defaulter").length;
  const highRiskCount = riskLoans.filter((l) => l.risk_tier === "high_risk").length;
  const watchCount = riskLoans.filter(
    (l) => l.risk_tier === "watch" || l.risk_tier === "early_overdue",
  ).length;

  const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const balance = income - expense;

  // last 6 months
  const months: { key: string; label: string; income: number; expense: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleString("en", { month: "short" }),
      income: 0,
      expense: 0,
    });
  }
  txs.forEach((t) => {
    const d = new Date(t.occurred_on);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    const m = months.find((x) => x.key === k);
    if (m) m[t.type as "income" | "expense"] += Number(t.amount);
  });

  // category breakdown (expenses)
  const catMap = new Map<string, number>();
  txs
    .filter((t) => t.type === "expense")
    .forEach((t) => {
      catMap.set(t.category, (catMap.get(t.category) ?? 0) + Number(t.amount));
    });
  const catData = Array.from(catMap.entries()).map(([name, value]) => ({ name, value }));
  const colors = [
    "oklch(0.32 0.06 155)",
    "oklch(0.72 0.13 80)",
    "oklch(0.55 0.14 155)",
    "oklch(0.55 0.2 25)",
    "oklch(0.5 0.02 150)",
  ];

  const stats = [
    { label: "Total income", value: fmt(income), icon: ArrowUpRight, tone: "text-success" },
    {
      label: "Total expenses",
      value: fmt(expense),
      icon: ArrowDownRight,
      tone: "text-destructive",
    },
    {
      label: "Balance",
      value: fmt(balance),
      icon: Wallet,
      tone: balance >= 0 ? "text-primary" : "text-destructive",
    },
    { label: "Donors", value: donorCount.toString(), icon: Users, tone: "text-primary" },
  ];
  const dashboardStats = canReviewLoanPayments
    ? [
        ...stats,
        {
          label: "Pending Loan Payments",
          value: pendingLoanPayments.toString(),
          icon: Clock,
          tone: "text-amber-600",
        },
      ]
    : stats;

  const recent = txs.slice(0, 6);

  if (r.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Loading your dashboard…</div>
    );
  }

  if (!isOfficer) {
    const confirmed = myContributions
      .filter((c) => c.status === "confirmed")
      .reduce((sum, c) => sum + Number(c.amount), 0);
    const pending = myContributions
      .filter((c) => c.status === "pending")
      .reduce((sum, c) => sum + Number(c.amount), 0);
    const activeLoans = myLoans.filter((l) => l.status === "approved");
    const outstanding = activeLoans.reduce((sum, loan) => {
      const repayments = loan.loan_repayments ?? [];
      const due = repayments.reduce((s, x) => s + Number(x.amount_due), 0);
      const paid = repayments
        .filter((repayment) => isRepaymentConfirmed(repayment))
        .reduce((s, x) => s + Number(x.amount_paid), 0);
      return sum + Math.max(0, due - paid);
    }, 0);

    const myStats = [
      {
        label: "My confirmed contributions",
        value: fmt(confirmed),
        icon: Wallet,
        tone: "text-success",
      },
      {
        label: "Awaiting confirmation",
        value: fmt(pending),
        icon: Hourglass,
        tone: "text-gold",
      },
      {
        label: "Active loans",
        value: String(activeLoans.length),
        icon: HandCoins,
        tone: "text-primary",
      },
      {
        label: "Loan balance outstanding",
        value: fmt(outstanding),
        icon: ArrowDownRight,
        tone: outstanding > 0 ? "text-destructive" : "text-primary",
      },
    ];
    const upcomingPayments = activeLoans
      .flatMap((loan) =>
        (loan.loan_repayments ?? [])
          .filter((repayment) => !isRepaymentConfirmed(repayment))
          .map((repayment) => ({ loan, repayment })),
      )
      .sort((a, b) => a.repayment.due_date.localeCompare(b.repayment.due_date))
      .slice(0, 2);

    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <PaymentInfoCard />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {myStats.map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </div>
                  <s.icon className={`h-4 w-4 ${s.tone}`} />
                </div>
                <div className={`mt-2 font-serif text-2xl font-semibold ${s.tone}`}>{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="font-serif">My Upcoming Payments</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Your next two scheduled installments.
              </p>
            </div>
            <Button asChild variant="link" className="px-0">
              <Link to="/my-loans">View full schedule</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {upcomingPayments.length === 0 ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> No upcoming loan payments.
              </div>
            ) : (
              <div className="divide-y">
                {upcomingPayments.map(({ loan, repayment }) => {
                  const pendingConfirmation = repayment.payment_status === "pending_confirmation";
                  const canLog = canLogRepayment(repayment);
                  return (
                    <div
                      key={repayment.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-start gap-3">
                        {pendingConfirmation ? (
                          <Clock className="mt-0.5 h-4 w-4 text-blue-600" />
                        ) : (
                          <CalendarDays className="mt-0.5 h-4 w-4 text-primary" />
                        )}
                        <div>
                          <div className="font-medium">
                            Installment #{repayment.installment_number} ·{" "}
                            {fmt(Number(repayment.amount_due))}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Due {new Date(repayment.due_date).toLocaleDateString("en-KE")} ·{" "}
                            {loan.loan_type} loan
                          </div>
                          {pendingConfirmation && (
                            <div className="text-xs text-blue-700">
                              Awaiting treasurer confirmation
                            </div>
                          )}
                        </div>
                      </div>
                      {canLog ? (
                        <RepaymentScheduleDialog
                          loan={loan}
                          canSubmitPayment
                          defaultInstallmentId={repayment.id}
                          openPaymentFormOnOpen
                          memberEmail={user.email ?? undefined}
                          triggerButton={
                            <Button
                              size="sm"
                              className="gap-1 bg-amber-500 text-white hover:bg-amber-600"
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              {repayment.payment_status === "rejected"
                                ? "Re-submit Payment"
                                : "Log Payment"}
                            </Button>
                          }
                        />
                      ) : (
                        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
                          Awaiting Confirmation
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-serif">Your records</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link to="/my-contributions">My contributions</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/my-loans">My loans</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/meetings">Meetings</Link>
            </Button>
            <Button asChild>
              <Link to="/my-account">My account</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PaymentInfoCard />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {dashboardStats.map((stat) => {
          const card = (
            <Card
              className={
                stat.label === "Pending Loan Payments"
                  ? "border-amber-300 bg-amber-50/40 transition-colors hover:border-amber-400"
                  : undefined
              }
            >
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {stat.label}
                  </div>
                  <stat.icon className={`h-4 w-4 ${stat.tone}`} />
                </div>
                <div className={`mt-2 font-serif text-2xl font-semibold ${stat.tone}`}>
                  {stat.value}
                </div>
              </CardContent>
            </Card>
          );

          return stat.label === "Pending Loan Payments" ? (
            <Link key={stat.label} to="/loans-review" className="block">
              {card}
            </Link>
          ) : (
            <div key={stat.label}>{card}</div>
          );
        })}
      </div>

      {/* Priority 5: Defaulter / Risk Flagging Alert Section */}
      {riskLoans.length > 0 ? (
        <Card className="border-rose-300 bg-rose-50/40">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-rose-600" />
                <CardTitle className="font-serif text-lg text-rose-950">
                  Credit Risk & Defaulter Alert
                </CardTitle>
                <Badge variant="destructive" className="ml-1 text-xs">
                  {riskLoans.length} Loans at Risk
                </Badge>
              </div>
              <Link
                to="/loans-review"
                className="inline-flex items-center gap-1 text-xs font-medium text-rose-800 hover:text-rose-950 underline"
              >
                Go to Loan Recovery & Review <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
              <div className="rounded bg-white/80 p-2.5 border border-rose-100">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  Total Past Due
                </div>
                <div className="font-serif text-lg font-bold text-rose-600">
                  {fmt(totalOverdue)}
                </div>
              </div>
              <div className="rounded bg-white/80 p-2.5 border border-rose-100">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  Critical (&gt;60d)
                </div>
                <div className="font-serif text-lg font-bold text-rose-700">{criticalCount}</div>
              </div>
              <div className="rounded bg-white/80 p-2.5 border border-rose-100">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  High Risk (&gt;30d)
                </div>
                <div className="font-serif text-lg font-bold text-amber-700">{highRiskCount}</div>
              </div>
              <div className="rounded bg-white/80 p-2.5 border border-rose-100">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  Watch List (1-30d)
                </div>
                <div className="font-serif text-lg font-bold text-slate-700">{watchCount}</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-md border border-rose-200 bg-white">
              <div className="divide-y divide-rose-100 text-xs">
                {riskLoans.slice(0, 4).map((rl) => (
                  <div key={rl.loan_id} className="flex items-center justify-between p-2.5">
                    <div>
                      <span className="font-medium text-foreground">
                        {rl.member_name || rl.member_email}
                      </span>
                      <span className="ml-2 text-muted-foreground">({rl.loan_type} loan)</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold text-rose-600">
                        {fmt(Number(rl.total_overdue_amount))} overdue
                      </span>
                      <Badge
                        className={
                          rl.risk_tier === "critical_defaulter"
                            ? "bg-rose-700 text-white"
                            : rl.risk_tier === "high_risk"
                              ? "bg-amber-600 text-white"
                              : "bg-amber-100 text-amber-800 border-amber-300"
                        }
                      >
                        {rl.max_days_overdue}d overdue
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-2.5 text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-medium">Loan Portfolio Health: Healthy</span>
            <span className="text-muted-foreground">
              • 0 loans currently in default or overdue.
            </span>
          </div>
          <Link to="/loans-review" className="text-emerald-900 font-medium hover:underline">
            View All Loans →
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-serif">Income vs Expenses — last 6 months</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months}>
                <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                  }}
                />
                <Legend />
                <Bar dataKey="income" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" fill="var(--color-gold)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-serif">Expenses by category</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {catData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No expenses yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={catData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                  >
                    {catData.map((_, i) => (
                      <Cell key={i} fill={colors[i % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-serif">Recent transactions</CardTitle>
          <Link to="/transactions" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {recent.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">{t.category}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(t.occurred_on).toLocaleDateString()} · {t.description ?? "—"}
                    </div>
                  </div>
                  <div
                    className={`font-serif text-lg font-semibold ${t.type === "income" ? "text-success" : "text-destructive"}`}
                  >
                    {t.type === "income" ? "+" : "−"}
                    {fmt(Number(t.amount))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
