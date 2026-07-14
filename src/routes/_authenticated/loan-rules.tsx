import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/loan-rules")({
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const qc = useQueryClient();

  const { data: rules } = useQuery({
    queryKey: ["loan-rules-admin"],
    enabled: r.isAdmin,
    queryFn: async () => (await supabase.from("loan_rules").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle()).data,
  });

  const [form, setForm] = useState({
    max_multiplier: "3",
    max_amount: "500000",
    min_membership_days: "90",
    interest_rate_percent: "10",
    max_repayment_months: "12",
    active: true,
  });

  useEffect(() => {
    if (rules) setForm({
      max_multiplier: String(rules.max_multiplier),
      max_amount: String(rules.max_amount),
      min_membership_days: String(rules.min_membership_days),
      interest_rate_percent: String(rules.interest_rate_percent),
      max_repayment_months: String(rules.max_repayment_months),
      active: rules.active,
    });
  }, [rules]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        max_multiplier: Number(form.max_multiplier),
        max_amount: Number(form.max_amount),
        min_membership_days: Number(form.min_membership_days),
        interest_rate_percent: Number(form.interest_rate_percent),
        max_repayment_months: Number(form.max_repayment_months),
        active: form.active,
        updated_by: user.id,
      };
      if (rules) {
        const { error } = await supabase.from("loan_rules").update(payload).eq("id", rules.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("loan_rules").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Rules saved"); qc.invalidateQueries({ queryKey: ["loan-rules-admin"] }); qc.invalidateQueries({ queryKey: ["loan-rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!r.isAdmin) return <div className="text-sm text-muted-foreground">Admins only.</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h2 className="font-serif text-2xl font-semibold text-primary">Loan Rules</h2>
        <p className="text-sm text-muted-foreground">Eligibility criteria used when a member submits a loan request.</p>
      </div>
      <Card className="p-5">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Max multiplier of confirmed contributions</Label>
              <Input type="number" step="0.1" min="0" value={form.max_multiplier} onChange={(e) => setForm({ ...form, max_multiplier: e.target.value })} />
            </div>
            <div>
              <Label>Max loan amount (KES)</Label>
              <Input type="number" min="0" value={form.max_amount} onChange={(e) => setForm({ ...form, max_amount: e.target.value })} />
            </div>
            <div>
              <Label>Minimum membership (days)</Label>
              <Input type="number" min="0" value={form.min_membership_days} onChange={(e) => setForm({ ...form, min_membership_days: e.target.value })} />
            </div>
            <div>
              <Label>Interest rate (%)</Label>
              <Input type="number" step="0.1" min="0" value={form.interest_rate_percent} onChange={(e) => setForm({ ...form, interest_rate_percent: e.target.value })} />
            </div>
            <div>
              <Label>Max repayment (months)</Label>
              <Input type="number" min="1" value={form.max_repayment_months} onChange={(e) => setForm({ ...form, max_repayment_months: e.target.value })} />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label className="mb-1">Rules active</Label>
            </div>
          </div>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save rules"}</Button>
        </form>
      </Card>
      <p className="text-xs text-muted-foreground">
        Loans are auto-flagged as eligible when they meet all criteria; the board still reviews every forwarded request.
      </p>
    </div>
  );
}
