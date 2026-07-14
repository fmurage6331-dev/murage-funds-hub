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
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/my-contributions")({
  component: MyContributionsPage,
});

const fmt = (n: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

function MyContributionsPage() {
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["my-contribs", user.id],
    queryFn: async () => (await supabase.from("contributions").select("*").eq("member_id", user.id).order("contributed_on", { ascending: false })).data ?? [],
  });

  const totals = rows.reduce(
    (acc, r) => {
      const n = Number(r.amount);
      if (r.status === "confirmed") acc.confirmed += n;
      else if (r.status === "pending") acc.pending += n;
      return acc;
    },
    { confirmed: 0, pending: 0 },
  );

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    amount: "",
    contributed_on: new Date().toISOString().slice(0, 10),
    method: "mpesa",
    reference: "",
    notes: "",
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("contributions").insert({
        member_id: user.id,
        amount: Number(form.amount),
        contributed_on: form.contributed_on,
        method: form.method,
        reference: form.reference || null,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contribution recorded. Awaiting treasurer confirmation.");
      setOpen(false);
      setForm({ ...form, amount: "", reference: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["my-contribs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contributions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["my-contribs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">My Contributions</h2>
          <p className="text-sm text-muted-foreground">Record what you've contributed. The treasurer confirms each entry.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> New contribution</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-serif">Record contribution</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Amount (KES)</Label>
                  <Input type="number" min="1" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" required value={form.contributed_on} onChange={(e) => setForm({ ...form, contributed_on: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Method</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mpesa">M-Pesa</SelectItem>
                    <SelectItem value="bank">Bank transfer</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reference / transaction code</Label>
                <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. QJ7X1A2B3C" />
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving…" : "Submit"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Confirmed total</div>
          <div className="mt-1 font-serif text-2xl text-success">{fmt(totals.confirmed)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Pending confirmation</div>
          <div className="mt-1 font-serif text-2xl text-gold">{fmt(totals.pending)}</div>
        </Card>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No contributions yet.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{new Date(r.contributed_on).toLocaleDateString()}</TableCell>
                <TableCell className="capitalize">{r.method}</TableCell>
                <TableCell className="text-muted-foreground">{r.reference ?? "—"}</TableCell>
                <TableCell>
                  <Badge className={
                    r.status === "confirmed" ? "bg-success text-success-foreground" :
                    r.status === "rejected" ? "bg-destructive/10 text-destructive" :
                    "bg-gold/20 text-gold"
                  }>{r.status}</Badge>
                </TableCell>
                <TableCell className="text-right font-medium">{fmt(Number(r.amount))}</TableCell>
                <TableCell>
                  {r.status === "pending" && (
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("Remove this entry?")) del.mutate(r.id); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
