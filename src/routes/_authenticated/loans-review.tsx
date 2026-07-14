import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/loans-review")({
  component: Page,
});

const fmt = (n: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
const statusColor = (s: string) =>
  s === "approved" ? "bg-success text-success-foreground" :
  s === "rejected" ? "bg-destructive/10 text-destructive" :
  s === "forwarded" ? "bg-primary/10 text-primary" :
  "bg-gold/20 text-gold";

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const qc = useQueryClient();

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loans", "review"],
    enabled: r.canForwardLoans || r.isBoard || r.isAdmin,
    queryFn: async () => (await supabase.from("loans").select("*, profiles:member_id(full_name, email)").order("created_at", { ascending: false })).data ?? [],
  });

  const forward = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("loans").update({
        status: "forwarded", forwarded_by: user.id, forwarded_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Forwarded to board"); qc.invalidateQueries({ queryKey: ["loans"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const reason = prompt("Rejection reason?") ?? "";
      if (!reason) throw new Error("Reason required");
      const { error } = await supabase.from("loans").update({
        status: "rejected", decision_at: new Date().toISOString(), rejection_reason: reason,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Rejected"); qc.invalidateQueries({ queryKey: ["loans"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!(r.canForwardLoans || r.isBoard || r.isAdmin)) {
    return <div className="text-sm text-muted-foreground">You do not have access to loan reviews.</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h2 className="font-serif text-2xl font-semibold text-primary">Loan Requests</h2>
        <p className="text-sm text-muted-foreground">Chairman or treasurer forwards eligible requests to the board.</p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Repay</TableHead>
              <TableHead>Eligibility</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-40">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : loans.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No loan requests.</TableCell></TableRow>
            ) : loans.map((l) => {
              const p = (l as any).profiles;
              return (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{p?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{p?.email}</div>
                  </TableCell>
                  <TableCell>{new Date(l.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="max-w-xs truncate">{l.purpose}</TableCell>
                  <TableCell>{l.repayment_months} mo</TableCell>
                  <TableCell className="max-w-[220px] text-xs">
                    <div className={l.auto_eligible ? "text-success" : "text-destructive"}>
                      {l.auto_eligible ? "Meets criteria" : "Below criteria"}
                    </div>
                    <div className="text-muted-foreground">{l.eligibility_note}</div>
                  </TableCell>
                  <TableCell><Badge className={statusColor(l.status)}>{l.status}</Badge></TableCell>
                  <TableCell className="text-right font-medium">{fmt(Number(l.amount))}</TableCell>
                  <TableCell>
                    {l.status === "submitted" && r.canForwardLoans && (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => forward.mutate(l.id)}>
                          <Send className="mr-1 h-3 w-3" /> Forward
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => reject.mutate(l.id)}>Reject</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
