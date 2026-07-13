import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownRight, ArrowUpRight, Users, Wallet } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, Legend } from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

function Dashboard() {
  const { data: txs = [] } = useQuery({
    queryKey: ["transactions", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("transactions").select("*").order("occurred_on", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: donorCount = 0 } = useQuery({
    queryKey: ["donors", "count"],
    queryFn: async () => {
      const { count } = await supabase.from("donors").select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

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
      income: 0, expense: 0,
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
  txs.filter((t) => t.type === "expense").forEach((t) => {
    catMap.set(t.category, (catMap.get(t.category) ?? 0) + Number(t.amount));
  });
  const catData = Array.from(catMap.entries()).map(([name, value]) => ({ name, value }));
  const colors = ["oklch(0.32 0.06 155)", "oklch(0.72 0.13 80)", "oklch(0.55 0.14 155)", "oklch(0.55 0.2 25)", "oklch(0.5 0.02 150)"];

  const stats = [
    { label: "Total income", value: fmt(income), icon: ArrowUpRight, tone: "text-success" },
    { label: "Total expenses", value: fmt(expense), icon: ArrowDownRight, tone: "text-destructive" },
    { label: "Balance", value: fmt(balance), icon: Wallet, tone: balance >= 0 ? "text-primary" : "text-destructive" },
    { label: "Donors", value: donorCount.toString(), icon: Users, tone: "text-primary" },
  ];

  const recent = txs.slice(0, 6);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</div>
                <s.icon className={`h-4 w-4 ${s.tone}`} />
              </div>
              <div className={`mt-2 font-serif text-2xl font-semibold ${s.tone}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="font-serif">Income vs Expenses — last 6 months</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months}>
                <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6 }} />
                <Legend />
                <Bar dataKey="income" fill="var(--color-primary)" radius={[4,4,0,0]} />
                <Bar dataKey="expense" fill="var(--color-gold)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-serif">Expenses by category</CardTitle></CardHeader>
          <CardContent className="h-72">
            {catData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No expenses yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={catData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                    {catData.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
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
          <Link to="/transactions" className="text-sm text-primary hover:underline">View all</Link>
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
                  <div className={`font-serif text-lg font-semibold ${t.type === "income" ? "text-success" : "text-destructive"}`}>
                    {t.type === "income" ? "+" : "−"}{fmt(Number(t.amount))}
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
