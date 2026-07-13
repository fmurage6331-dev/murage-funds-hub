import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Mail, Phone, MapPin } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/donors")({
  component: DonorsPage,
});

const fmt = (n: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

function DonorsPage() {
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();

  const { data: role = [] } = useQuery({
    queryKey: ["role", user.id],
    queryFn: async () => (await supabase.from("user_roles").select("role").eq("user_id", user.id)).data?.map(r => r.role) ?? [],
  });
  const isAdmin = role.includes("admin");

  const { data: donors = [], isLoading } = useQuery({
    queryKey: ["donors", "with-totals"],
    queryFn: async () => {
      const { data: ds } = await supabase.from("donors").select("*").order("name");
      const { data: txs } = await supabase.from("transactions").select("donor_id, amount").eq("type", "income");
      const totals = new Map<string, number>();
      txs?.forEach(t => { if (t.donor_id) totals.set(t.donor_id, (totals.get(t.donor_id) ?? 0) + Number(t.amount)); });
      return (ds ?? []).map(d => ({ ...d, total: totals.get(d.id) ?? 0 }));
    },
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", notes: "" });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("donors").insert({ ...form, created_by: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Donor added");
      setOpen(false);
      setForm({ name: "", email: "", phone: "", address: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["donors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("donors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["donors"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">Donors</h2>
          <p className="text-sm text-muted-foreground">People and organisations supporting the foundation.</p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Add donor</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-serif">New donor</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3">
                <div><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                  <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                </div>
                <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <div><Label>Notes</Label><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                <DialogFooter><Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving..." : "Save donor"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : donors.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">No donors yet.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {donors.map(d => (
            <Card key={d.id} className="relative">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-serif text-lg font-semibold text-primary">{d.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-wider text-gold">
                      Total: {fmt(d.total)}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Delete ${d.name}?`)) del.mutate(d.id); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
                <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                  {d.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {d.email}</div>}
                  {d.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {d.phone}</div>}
                  {d.address && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> {d.address}</div>}
                  {d.notes && <p className="pt-2 text-xs italic">{d.notes}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
