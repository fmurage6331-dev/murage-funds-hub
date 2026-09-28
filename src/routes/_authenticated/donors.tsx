import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Pencil, Trash2, Mail, Phone, MapPin } from "lucide-react";
import { toast } from "sonner";
import { UnauthorizedCard } from "@/components/shared/UnauthorizedCard";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/donors")({
  component: DonorsPage,
});

type DonorForm = { name: string; email: string; phone: string; address: string; notes: string };

const emptyForm: DonorForm = { name: "", email: "", phone: "", address: "", notes: "" };

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

function DonorsPage() {
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();

  const r = useRoles(user.id);
  const canManageDonors = r.isAdmin || r.isSecretary || r.isAssistantSecretary;

  const { data: donors = [], isLoading } = useQuery({
    queryKey: ["donors", "with-totals"],
    enabled: canManageDonors,
    queryFn: async () => {
      try {
        const { data: ds, error } = await supabase.from("donors").select("*").order("name");
        if (error) throw error;
        const { data: txs, error: txsError } = await supabase
          .from("transactions")
          .select("donor_id, amount")
          .eq("type", "income");
        if (txsError) throw txsError;
        const totals = new Map<string, number>();
        (txs ?? []).forEach((t) => {
          if (t.donor_id) totals.set(t.donor_id, (totals.get(t.donor_id) ?? 0) + Number(t.amount));
        });
        return (ds ?? []).map((d) => ({ ...d, total: totals.get(d.id) ?? 0 }));
      } catch (error) {
        console.error("Failed to load donors", error);
        toast.error("Could not load donors.");
        return [];
      }
    },
  });

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DonorForm>(emptyForm);

  const closeDialog = () => {
    setOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const startEdit = (donor: (typeof donors)[number]) => {
    setEditingId(donor.id);
    setForm({
      name: donor.name,
      email: donor.email ?? "",
      phone: donor.phone ?? "",
      address: donor.address ?? "",
      notes: donor.notes ?? "",
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Donor name is required.");

      if (editingId) {
        const { error } = await supabase.from("donors").update(form).eq("id", editingId);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("donors").insert({ ...form, created_by: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editingId ? "Donor updated" : "Donor added");
      closeDialog();
      void qc.invalidateQueries({ queryKey: ["donors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("donors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      void qc.invalidateQueries({ queryKey: ["donors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (r.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  if (!r.isAdmin && !r.isSecretary && !r.isAssistantSecretary) {
    return <UnauthorizedCard message="This page is restricted to secretariat." />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">Donors</h2>
          <p className="text-sm text-muted-foreground">
            People and organisations supporting the foundation.
          </p>
        </div>
        {canManageDonors && (
          <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())}>
            <DialogTrigger asChild>
              <Button
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm);
                  setOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Add Donor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-serif">
                  {editingId ? "Edit donor" : "New donor"}
                </DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
                className="space-y-3"
              >
                <div>
                  <Label>Name *</Label>
                  <Input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Address</Label>
                  <Input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={save.isPending}>
                    {save.isPending ? "Saving..." : "Save donor"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : donors.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No donors yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {donors.map((d) => (
            <Card key={d.id} className="relative">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-serif text-lg font-semibold text-primary">{d.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-wider text-gold">
                      Total: {fmt(d.total)}
                    </div>
                  </div>
                  {canManageDonors && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${d.name}`}
                        disabled={save.isPending || del.isPending}
                        onClick={() => startEdit(d)}
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      {r.isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${d.name}`}
                          disabled={del.isPending}
                          onClick={() => {
                            if (confirm(`Delete ${d.name}?`)) del.mutate(d.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                  {d.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5" /> {d.email}
                    </div>
                  )}
                  {d.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5" /> {d.phone}
                    </div>
                  )}
                  {d.address && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5" /> {d.address}
                    </div>
                  )}
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
