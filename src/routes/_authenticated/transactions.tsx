import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/transactions")({
  component: TransactionsPage,
});

const fmt = (n: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

const INCOME_CATS = ["Donation", "Grant", "Fundraiser", "Interest", "Other income"];
const EXPENSE_CATS = ["Programs", "Salaries", "Rent", "Utilities", "Supplies", "Travel", "Admin", "Other expense"];

function TransactionsPage() {
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();

  const { data: role = [] } = useQuery({
    queryKey: ["role", user.id],
    queryFn: async () => (await supabase.from("user_roles").select("role").eq("user_id", user.id)).data?.map(r => r.role) ?? [],
  });
  const isAdmin = role.includes("admin");

  const { data: txs = [], isLoading } = useQuery({
    queryKey: ["transactions", "all"],
    queryFn: async () => (await supabase.from("transactions").select("*, donors(name)").order("occurred_on", { ascending: false })).data ?? [],
  });

  const { data: donors = [] } = useQuery({
    queryKey: ["donors", "list"],
    queryFn: async () => (await supabase.from("donors").select("id, name").order("name")).data ?? [],
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    type: "income" as "income" | "expense",
    category: "Donation",
    amount: "",
    occurred_on: new Date().toISOString().slice(0, 10),
    description: "",
    donor_id: "",
    reference: "",
  });

  const createTx = useMutation({
    mutationFn: async () => {
      const payload = {
        type: form.type,
        category: form.category,
        amount: Number(form.amount),
        occurred_on: form.occurred_on,
        description: form.description || null,
        donor_id: form.donor_id || null,
        reference: form.reference || null,
        created_by: user.id,
      };
      const { error } = await supabase.from("transactions").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transaction added");
      setOpen(false);
      setForm({ ...form, amount: "", description: "", reference: "", donor_id: "" });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("transactions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["transactions"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCsv = () => {
    const rows = [["Date","Type","Category","Amount","Currency","Description","Donor","Reference"]];
    txs.forEach((t) => rows.push([
      t.occurred_on, t.type, t.category, String(t.amount), t.currency,
      t.description ?? "", (t as any).donors?.name ?? "", t.reference ?? "",
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `transactions-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const cats = form.type === "income" ? INCOME_CATS : EXPENSE_CATS;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">Transactions</h2>
          <p className="text-sm text-muted-foreground">All income and expenses on record.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={txs.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          {isAdmin && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="mr-2 h-4 w-4" /> New transaction</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle className="font-serif">Add transaction</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); createTx.mutate(); }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Type</Label>
                      <Select value={form.type} onValueChange={(v: "income" | "expense") => setForm({ ...form, type: v, category: v === "income" ? INCOME_CATS[0] : EXPENSE_CATS[0] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="income">Income</SelectItem>
                          <SelectItem value="expense">Expense</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Category</Label>
                      <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {cats.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Amount (KES)</Label>
                      <Input type="number" min="0" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </div>
                    <div>
                      <Label>Date</Label>
                      <Input type="date" required value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} />
                    </div>
                  </div>
                  {form.type === "income" && (
                    <div>
                      <Label>Donor (optional)</Label>
                      <Select value={form.donor_id || "none"} onValueChange={(v) => setForm({ ...form, donor_id: v === "none" ? "" : v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— None —</SelectItem>
                          {donors.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label>Reference / receipt #</Label>
                    <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={createTx.isPending}>{createTx.isPending ? "Saving..." : "Save"}</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Donor</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {isAdmin && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : txs.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No transactions yet.</TableCell></TableRow>
            ) : txs.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{new Date(t.occurred_on).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Badge variant={t.type === "income" ? "default" : "secondary"} className={t.type === "income" ? "bg-success text-success-foreground" : "bg-destructive/10 text-destructive"}>
                    {t.type}
                  </Badge>
                </TableCell>
                <TableCell>{t.category}</TableCell>
                <TableCell className="text-muted-foreground">{(t as any).donors?.name ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground">{t.description ?? "—"}</TableCell>
                <TableCell className={`text-right font-medium ${t.type === "income" ? "text-success" : "text-destructive"}`}>
                  {t.type === "income" ? "+" : "−"}{fmt(Number(t.amount))}
                </TableCell>
                {isAdmin && (
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this transaction?")) del.mutate(t.id); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
