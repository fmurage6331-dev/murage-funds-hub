import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Check, RotateCw, X } from "lucide-react";
import { toast } from "sonner";

type Application = Tables<"pending_registrations">;
type ReviewAction = { action: "approve" | "retry" | "reject"; registrationId: string; reason?: string };
type ReviewResponse = { success: boolean; error?: string; warning?: string };

function isReviewResponse(value: unknown): value is ReviewResponse {
  return typeof value === "object" && value !== null && "success" in value &&
    typeof value.success === "boolean";
}

async function reviewRegistration(action: ReviewAction): Promise<ReviewResponse> {
  const { data, error } = await supabase.functions.invoke("manage-registration", { body: action });
  if (error) {
    if ("context" in error && error.context instanceof Response) {
      const failure: unknown = await error.context.json();
      if (isReviewResponse(failure) && failure.error) throw new Error(failure.error);
    }
    throw new Error(error.message);
  }
  const response: unknown = data;
  if (!isReviewResponse(response) || !response.success) {
    throw new Error(isReviewResponse(response) ? response.error ?? "Review failed" : "Invalid server response");
  }
  return response;
}

export function PendingBotRegistrations() {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<Application | null>(null);
  const [reason, setReason] = useState("");
  const { data = { pending: [], unsent: [] }, isLoading, error } = useQuery({
    queryKey: ["pending-bot-registrations"],
    queryFn: async () => {
      try {
        const [pending, unsent] = await Promise.all([
          supabase.from("pending_registrations").select("*").eq("status", "pending")
            .order("created_at", { ascending: false }),
          supabase.from("pending_registrations").select("*").eq("status", "approved")
            .eq("invite_sent", false).order("created_at", { ascending: false }),
        ]);
        if (pending.error) throw pending.error;
        if (unsent.error) throw unsent.error;
        return { pending: pending.data ?? [], unsent: unsent.data ?? [] };
      } catch (queryError) {
        console.error("[users] registration query failed", queryError);
        throw queryError;
      }
    },
  });

  const review = useMutation({
    mutationFn: reviewRegistration,
    onSuccess: (result, action) => {
      if (result.warning) toast.warning(result.warning);
      else toast.success(action.action === "reject" ? "Application rejected" : action.action === "retry" ? "Welcome message sent" : "Member approved and notified");
      setRejecting(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["pending-bot-count"] });
      void qc.invalidateQueries({ queryKey: ["pending-bot-registrations"] });
      void qc.invalidateQueries({ queryKey: ["users-with-roles"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-serif text-lg font-semibold">Applications from WhatsApp & SMS</h3>
        <p className="text-sm text-muted-foreground">
          Review phone-only and email members. Only approved email applicants receive a password setup link.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">Could not load registrations: {error.message}</p>}
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Full Name</TableHead>
              <TableHead>Phone Number</TableHead>
              <TableHead>Requested Role</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Date Applied</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center">Loading applications…</TableCell></TableRow>
            ) : data.pending.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No registrations awaiting review.</TableCell></TableRow>
            ) : data.pending.map((application) => (
              <TableRow key={application.id}>
                <TableCell className="font-medium">{application.full_name}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs">+{application.phone_number}</TableCell>
                <TableCell><Badge variant="secondary" className="capitalize">{application.requested_role.replace(/_/g, " ")}</Badge></TableCell>
                <TableCell>{application.email ?? <Badge variant="outline">📱 Phone Only</Badge>}</TableCell>
                <TableCell><Badge variant="outline">{application.registration_channel === "sms" ? "📱 SMS" : "💬 WhatsApp"}</Badge></TableCell>
                <TableCell className="whitespace-nowrap">{new Date(application.created_at).toLocaleDateString("en-KE")}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" disabled={review.isPending}
                      aria-label={`Approve ${application.full_name}`}
                      onClick={() => review.mutate({ action: "approve", registrationId: application.id })}>
                      <Check className="mr-1 h-3 w-3" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={review.isPending}
                      aria-label={`Reject ${application.full_name}`}
                      onClick={() => { setReason(""); setRejecting(application); }}>
                      <X className="mr-1 h-3 w-3" /> Reject
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {data.unsent.length > 0 && (
        <Card className="space-y-2 p-4">
          <h3 className="font-semibold">Approved — welcome message not delivered</h3>
          <p className="text-xs text-muted-foreground">The account is active; retry delivery after checking your Africa’s Talking settings.</p>
          {data.unsent.map((application) => (
            <div key={application.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
              <span>{application.full_name} · +{application.phone_number}</span>
              <Button size="sm" variant="outline" disabled={review.isPending}
                onClick={() => review.mutate({ action: "retry", registrationId: application.id })}>
                <RotateCw className="mr-1 h-3 w-3" /> Retry welcome message
              </Button>
            </div>
          ))}
        </Card>
      )}

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject registration?</DialogTitle>
            <DialogDescription>The reason will be sent to {rejecting?.full_name} by WhatsApp or SMS.</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Reason for rejection" placeholder="Please explain your decision (at least 5 characters)"
            value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={review.isPending}>Cancel</Button>
            <Button variant="destructive" disabled={review.isPending || reason.trim().length < 5}
              onClick={() => rejecting && review.mutate({ action: "reject", registrationId: rejecting.id, reason: reason.trim() })}>
              {review.isPending ? "Submitting…" : "Reject and notify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
