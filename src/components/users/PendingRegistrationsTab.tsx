import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Check, MessageCircle, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

type Registration = Database["public"]["Tables"]["pending_registrations"]["Row"];
type Review = { registration: Registration; action: "approve" | "reject" };
type ReviewResponse = { success?: boolean; sent?: boolean; message?: string; error?: string };

type Props = {
  registrations: Registration[];
  isLoading: boolean;
  error: Error | null;
  onReviewed: () => void;
};

export function PendingRegistrationsTab({ registrations, isLoading, error, onReviewed }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [reason, setReason] = useState("");
  const close = () => {
    setReview(null);
    setReason("");
  };

  const submit = useMutation({
    mutationFn: async ({ registration, action }: Review) => {
      try {
        const { data, error: invokeError } = await supabase.functions.invoke<ReviewResponse>(
          "review-registration",
          {
            body: {
              id: registration.id,
              action,
              ...(action === "reject" ? { reason: reason.trim() } : {}),
            },
          },
        );
        if (invokeError) {
          let detail = invokeError.message;
          if ("context" in invokeError && invokeError.context instanceof Response) {
            const response: unknown = await invokeError.context.json();
            if (
              response &&
              typeof response === "object" &&
              "error" in response &&
              typeof response.error === "string"
            ) {
              detail = response.error;
            }
          }
          throw new Error(detail);
        }
        if (!data?.success) throw new Error(data?.error ?? "Could not review the application");
        return data;
      } catch (caught) {
        console.error("[registration review] Request failed:", caught);
        throw caught;
      }
    },
    onSuccess: (result) => {
      if (result.sent) toast.success(result.message ?? "Applicant notified");
      else toast.warning(result.message ?? "Saved, but delivery failed. Please retry.");
      close();
      onReviewed();
    },
    onError: (caught: Error) => toast.error(caught.message),
  });

  if (isLoading)
    return <Card className="p-8 text-center text-muted-foreground">Loading applications…</Card>;
  if (error)
    return (
      <Card className="p-8 text-destructive" role="alert">
        Unable to load applications: {error.message}
      </Card>
    );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Review bot applications before granting access. Phone-only members have no web login.
      </p>
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
            {registrations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No registrations awaiting review.
                </TableCell>
              </TableRow>
            ) : (
              registrations.map((application) => (
                <TableRow key={application.id}>
                  <TableCell className="font-medium">{application.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">+{application.phone_number}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {application.requested_role.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {application.email || (
                      <Badge variant="outline" className="gap-1">
                        <Smartphone className="h-3 w-3" /> Phone Only
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="gap-1 capitalize">
                      {application.registration_channel === "sms" ? (
                        <Smartphone className="h-3 w-3" />
                      ) : (
                        <MessageCircle className="h-3 w-3" />
                      )}
                      {application.registration_channel}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {new Date(application.created_at).toLocaleDateString("en-KE")}
                  </TableCell>
                  <TableCell className="text-right">
                    {application.status === "approved" && !application.consent_given ? (
                      <Badge variant="outline">Opted out · await JOIN</Badge>
                    ) : application.status === "approved" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={submit.isPending}
                        onClick={() => setReview({ registration: application, action: "approve" })}
                      >
                        Retry invite
                      </Button>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={submit.isPending}
                          onClick={() =>
                            setReview({ registration: application, action: "approve" })
                          }
                        >
                          <Check className="mr-1 h-4 w-4 text-success" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={submit.isPending}
                          onClick={() => setReview({ registration: application, action: "reject" })}
                        >
                          <X className="mr-1 h-4 w-4 text-destructive" /> Reject
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !submit.isPending) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {review?.action === "approve" ? "Approve registration" : "Reject registration"}
            </DialogTitle>
            <DialogDescription>
              {review?.registration.full_name} (+{review?.registration.phone_number})
              {review?.action === "approve" && review.registration.email && (
                <span className="mt-2 block text-amber-700">
                  Verify this applicant owns {review.registration.email} before approving. Their
                  password setup link will be sent to their phone.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {review?.action === "reject" && (
            <div className="space-y-2">
              <Label htmlFor="rejection-reason">Reason (sent to the applicant)</Label>
              <Textarea
                id="rejection-reason"
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Please explain why the application was not approved"
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submit.isPending} onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                submit.isPending || (review?.action === "reject" && reason.trim().length < 3)
              }
              onClick={() => review && submit.mutate(review)}
            >
              {submit.isPending
                ? "Saving…"
                : review?.action === "approve"
                  ? "Confirm approval"
                  : "Send rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
