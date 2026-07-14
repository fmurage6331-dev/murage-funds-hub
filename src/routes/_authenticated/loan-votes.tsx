import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/loan-votes")({
  component: Page,
});

const fmt = (n: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
const statusColor = (s: string) =>
  s === "approved" ? "bg-success text-success-foreground" :
  s === "rejected" ? "bg-destructive/10 text-destructive" :
  "bg-primary/10 text-primary";

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const qc = useQueryClient();
  const [comments, setComments] = useState<Record<string, string>>({});

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["board-loans"],
    enabled: r.isBoard || r.isAdmin,
    queryFn: async () => (await supabase.from("loans").select("*, profiles:member_id(full_name, email), loan_votes(*)")
      .in("status", ["forwarded", "approved", "rejected"]).order("forwarded_at", { ascending: false })).data ?? [],
  });

  const vote = useMutation({
    mutationFn: async ({ loan_id, v }: { loan_id: string; v: "approve" | "reject" }) => {
      const { error } = await supabase.from("loan_votes").insert({
        loan_id, board_member_id: user.id, vote: v, comment: comments[loan_id] || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Vote recorded"); qc.invalidateQueries({ queryKey: ["board-loans"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!(r.isBoard || r.isAdmin)) {
    return <div className="text-sm text-muted-foreground">Only board members can vote on loans.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h2 className="font-serif text-2xl font-semibold text-primary">Board Votes</h2>
        <p className="text-sm text-muted-foreground">Forwarded loan requests awaiting board decision. Majority of board members approves.</p>
      </div>

      {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> :
       loans.length === 0 ? <Card className="p-8 text-center text-muted-foreground">Nothing to vote on.</Card> :
       loans.map((l) => {
        const votes = (l as any).loan_votes as { vote: string; board_member_id: string; comment: string | null }[];
        const approves = votes.filter((v) => v.vote === "approve").length;
        const rejects = votes.filter((v) => v.vote === "reject").length;
        const myVote = votes.find((v) => v.board_member_id === user.id);
        const p = (l as any).profiles;
        return (
          <Card key={l.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-serif text-lg font-semibold">{fmt(Number(l.amount))}</span>
                  <Badge className={statusColor(l.status)}>{l.status}</Badge>
                </div>
                <div className="mt-1 text-sm">
                  <span className="font-medium">{p?.full_name ?? "—"}</span>
                  <span className="text-muted-foreground"> · {p?.email}</span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{l.purpose}</div>
                <div className="mt-1 text-xs text-muted-foreground">Repayment: {l.repayment_months} months</div>
                <div className="mt-1 text-xs">
                  Eligibility: {l.auto_eligible ? <span className="text-success">Meets criteria</span> : <span className="text-destructive">{l.eligibility_note}</span>}
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>Approve: <span className="font-medium text-success">{approves}</span></div>
                <div>Reject: <span className="font-medium text-destructive">{rejects}</span></div>
              </div>
            </div>

            {l.status === "forwarded" && r.isBoard && !myVote && (
              <div className="mt-4 space-y-2 border-t border-border pt-4">
                <Textarea rows={2} placeholder="Optional comment"
                  value={comments[l.id] ?? ""}
                  onChange={(e) => setComments({ ...comments, [l.id]: e.target.value })} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => vote.mutate({ loan_id: l.id, v: "approve" })}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => vote.mutate({ loan_id: l.id, v: "reject" })}>Reject</Button>
                </div>
              </div>
            )}
            {myVote && (
              <div className="mt-3 text-xs text-muted-foreground">You voted <span className="font-medium capitalize text-foreground">{myVote.vote}</span>{myVote.comment ? ` — "${myVote.comment}"` : ""}</div>
            )}
            {l.rejection_reason && l.status === "rejected" && (
              <div className="mt-3 text-xs text-destructive">Reason: {l.rejection_reason}</div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
