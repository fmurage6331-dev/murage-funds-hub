import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/contributions-review")({
  component: Page,
});

const fmt = (n: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["contribs", "all"],
    enabled: r.canConfirmContribs,
    queryFn: async () => {
      const { data } = await supabase.from("contributions").select("*, profiles:member_id(full_name, email)").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "confirmed" | "rejected" }) => {
      const { error } = await supabase.from("contributions").update({
        status,
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["contribs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!r.canConfirmContribs) {
    return <div className="text-sm text-muted-foreground">Only the treasurer or admin can review contributions.</div>;
  }

  const pending = rows.filter((x) => x.status === "pending");

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h2 className="font-serif text-2xl font-semibold text-primary">Contributions Review</h2>
        <p className="text-sm text-muted-foreground">{pending.length} pending confirmation.</p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No contributions yet.</TableCell></TableRow>
            ) : rows.map((row) => {
              const p = (row as any).profiles;
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">{p?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{p?.email}</div>
                  </TableCell>
                  <TableCell>{new Date(row.contributed_on).toLocaleDateString()}</TableCell>
                  <TableCell className="capitalize">{row.method}</TableCell>
                  <TableCell className="text-muted-foreground">{row.reference ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={
                      row.status === "confirmed" ? "bg-success text-success-foreground" :
                      row.status === "rejected" ? "bg-destructive/10 text-destructive" :
                      "bg-gold/20 text-gold"
                    }>{row.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">{fmt(Number(row.amount))}</TableCell>
                  <TableCell>
                    {row.status === "pending" && (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setStatus.mutate({ id: row.id, status: "confirmed" })}>
                          <Check className="h-4 w-4 text-success" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setStatus.mutate({ id: row.id, status: "rejected" })}>
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
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
