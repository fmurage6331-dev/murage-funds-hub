import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/my-loans")({
  component: Page,
});

const fmt = (n: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

const statusColor = (s: string) =>
  s === "approved" ? "bg-success text-success-foreground" :
  s === "rejected" ? "bg-destructive/10 text-destructive" :
  s === "forwarded" ? "bg-primary/10 text-primary" :
  "bg-gold/20 text-gold";

function Page() {
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["my-loans", user.id],
    queryFn: async () => (await supabase.from("loans").select("*").eq("member_id", user.id).order("created_at", { ascending: false })).data ?? [],
  });

  const { data: rulesByType } = useQuery({
    queryKey: ["loan-rules"],
    queryFn: async () => {
      const { data } = await supabase.from("loan_rules").select("*").eq("active", true);
      return Object.fromEntries((data ?? []).map((r) => [r.loan_type, r]));
    },
  });

  const { data: confirmed = 0 } = useQuery({
    queryKey: ["confirmed-total", user.id],
    queryFn: async () => {
      const { data } = await supabase.from("contributions").select("amount").eq("member_id", user.id).eq("status", "confirmed");
      return (data ?? []).reduce((s, r) => s + Number(r.amount), 0);
    },
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ loan_type: "project" | "emergency"; amount: string; purpose: string; repayment_months: string }>({
    loan_type: "project", amount: "", purpose: "", repayment_months: "6",
  });
  const activeRules = rulesByType?.[form.loan_type];

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("loans").insert({
        member_id: user.id,
        loan_type: form.loan_type,
        amount: Number(form.amount),
        purpose: form.purpose,
        repayment_months: Number(form.repayment_months),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Loan request submitted");
      setOpen(false);
      setForm({ loan_type: "project", amount: "", purpose: "", repayment_months: "6" });
      qc.invalidateQueries({ queryKey: ["my-loans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">My Loans</h2>
          <p className="text-sm text-muted-foreground">Request a loan against your contributions.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Request loan</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-serif">Request a loan</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3">
              <div>
                <Label>Loan type</Label>
                <Select value={form.loan_type} onValueChange={(v: "project" | "emergency") => setForm({ ...form, loan_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project">Project loan</SelectItem>
                    <SelectItem value="emergency">Emergency loan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {activeRules && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  Eligibility: up to {activeRules.max_multiplier}× confirmed contributions (max {fmt(Number(activeRules.max_amount))}), repaid within {activeRules.max_repayment_months} months, minimum {activeRules.min_membership_days} days membership, {activeRules.interest_rate_percent}% interest. Your confirmed contributions: <span className="font-medium text-foreground">{fmt(confirmed)}</span>.
                </div>
              )}
              <div>
                <Label>Amount (KES)</Label>
                <Input type="number" min="1" step="1" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <Label>Repayment period (months)</Label>
                <Input type="number" min="1" required value={form.repayment_months} onChange={(e) => setForm({ ...form, repayment_months: e.target.value })} />
              </div>
              <div>
                <Label>Purpose</Label>
                <Textarea rows={3} required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={create.isPending}>{create.isPending ? "Submitting…" : "Submit request"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : loans.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No loan requests yet.</TableCell></TableRow>
            ) : loans.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{new Date(l.created_at).toLocaleDateString()}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{l.loan_type}</Badge></TableCell>
                <TableCell className="max-w-xs truncate">{l.purpose}</TableCell>
                <TableCell>{l.repayment_months} mo</TableCell>
                <TableCell className="max-w-xs text-xs text-muted-foreground">
                  {l.auto_eligible ? <span className="text-success">Meets criteria</span> : <span title={l.eligibility_note ?? ""}>Needs board review</span>}
                </TableCell>
                <TableCell><Badge className={statusColor(l.status)}>{l.status}</Badge></TableCell>
                <TableCell className="text-right font-medium">{fmt(Number(l.amount))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
