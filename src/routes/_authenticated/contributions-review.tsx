import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, X, PlusCircle, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { useRoles } from "@/hooks/use-roles";
import { notifyContributionReview } from "@/lib/notifications";
import { ContributionImportPanel } from "@/components/contributions/ContributionImportPanel";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/contributions-review")({
  component: Page,
});

/** Query key shared by the review list, its realtime invalidation and mutations. */
const CONTRIBUTIONS_REVIEW_KEY = ["contributions-review"] as const;

/**
 * `contributions.member_id` points at `auth.users(id)`, so there is no direct
 * FK to `public.profiles` and the `profiles (...)` embed is not guaranteed to
 * resolve. Try it once, then fall back to the merged loader for the session.
 */
let profilesEmbedSupported = true;

type ContributionStatus = "all" | "pending" | "confirmed" | "rejected";

type ProfileSummary = {
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
};

/** A contribution row plus the joined member profile (embedded or merged client-side). */
type ContributionRow = Tables<"contributions"> & {
  profiles?: ProfileSummary | ProfileSummary[] | null;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

/** PostgREST may embed a to-one relation as a single object; normalise both shapes. */
function profileOf(row: ContributionRow): ProfileSummary | null {
  const joined = row.profiles;
  if (!joined) return null;
  return Array.isArray(joined) ? (joined[0] ?? null) : joined;
}

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const queryClient = useQueryClient();

  // ── Status tabs — "Pending" is the default so new member submissions are
  //    the first thing the treasurer sees. ────────────────────────────────
  const [statusTab, setStatusTab] = useState<ContributionStatus>("pending");

  // ── Log on behalf dialog state ────────────────────────────────────────
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [mpesaRef, setMpesaRef] = useState("");
  const [contribDate, setContribDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("mpesa");
  const [notes, setNotes] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const canReview = r.isAdmin || r.isTreasurer;

  /**
   * Every contribution, newest first, with the member profile joined in.
   *
   * No status filter is applied server-side: RLS already limits the treasurer
   * to rows they are allowed to see, and filtering here previously hid pending
   * member submissions.
   */
  const {
    data: contributions = [],
    isLoading,
    isFetching,
    error: contributionsError,
  } = useQuery<ContributionRow[]>({
    queryKey: [...CONTRIBUTIONS_REVIEW_KEY],
    enabled: canReview,
    queryFn: async () => {
      try {
        if (profilesEmbedSupported) {
          const { data, error } = await supabase
            .from("contributions")
            .select(
              `
                *,
                profiles (
                  full_name,
                  email,
                  phone_number
                )
              `,
            )
            .order("created_at", { ascending: false });

          if (!error) {
            // The generated schema types cannot describe this embed, so the
            // payload is asserted to the row shape this page renders.
            return (data ?? []) as unknown as ContributionRow[];
          }

          // `contributions.member_id` references `auth.users`, not
          // `public.profiles`, so PostgREST may be unable to resolve the
          // embed. Stop retrying it and switch to the merged loader — the
          // review queue must never be blank because of a schema-cache miss.
          profilesEmbedSupported = false;
          console.warn("[contributions-review] profiles embed unavailable, using merge:", error);
        }

        return await fetchContributionsWithMergedProfiles();
      } catch (error) {
        throw error instanceof Error ? error : new Error("Failed to load contributions.");
      }
    },
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
    staleTime: 0,
  });

  /** Approved members query for the searchable select. */
  const { data: approvedMembers = [] } = useQuery({
    queryKey: ["approved-members-for-officer-entry"],
    enabled: canReview,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name, phone_number, email")
          .eq("status", "approved")
          .order("full_name");
        if (error) throw error;
        return data ?? [];
      } catch (error) {
        console.error("Failed to load approved members", error);
        toast.error("Could not load the member list.");
        return [];
      }
    },
  });

  /**
   * Realtime: new member contributions appear instantly instead of waiting for
   * the polling interval or a manual refresh.
   */
  useEffect(() => {
    const channel = supabase
      .channel("contributions-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contributions",
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: [...CONTRIBUTIONS_REVIEW_KEY] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return approvedMembers;
    const q = memberSearch.toLowerCase();
    return approvedMembers.filter((m) => {
      const name = (m.full_name ?? "").toLowerCase();
      const phone = (m.phone_number ?? "").toLowerCase();
      const email = (m.email ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || email.includes(q);
    });
  }, [approvedMembers, memberSearch]);

  const currentRole = r.isAdmin ? "admin" : r.isTreasurer ? "treasurer" : "officer";

  /** References already on record, used to skip duplicate M-Pesa refs on import. */
  const existingRefs = useMemo(
    () => contributions.map((row) => row.reference ?? "").filter((ref) => ref !== ""),
    [contributions],
  );

  const counts = useMemo(() => {
    const tally = { pending: 0, confirmed: 0, rejected: 0 };
    contributions.forEach((row) => {
      if (row.status === "pending" || row.status === "confirmed" || row.status === "rejected") {
        tally[row.status] += 1;
      }
    });
    return tally;
  }, [contributions]);

  const visibleRows = useMemo(
    () =>
      statusTab === "all" ? contributions : contributions.filter((x) => x.status === statusTab),
    [contributions, statusTab],
  );

  const logOnBehalfMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMemberId) throw new Error("Please select a member.");
      const parsedAmount = Number(amount);
      if (isNaN(parsedAmount) || parsedAmount < 1)
        throw new Error("Amount must be at least 1 KES.");
      if (!mpesaRef.trim()) throw new Error("M-Pesa Reference is required.");
      if (!contribDate) throw new Error("Date is required.");

      const { error } = await supabase.from("contributions").insert({
        member_id: selectedMemberId,
        amount: parsedAmount,
        status: "confirmed",
        method: paymentMethod,
        reference: mpesaRef.trim(),
        contributed_on: contribDate,
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
        entered_by: user.id,
        entered_by_role: currentRole,
        on_behalf_of: true,
        paybill_number: "522522",
        mpesa_transaction_id: mpesaRef.trim(),
        notes: notes.trim() ? notes.trim() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contribution logged successfully on behalf of member!");
      setLogDialogOpen(false);
      setSelectedMemberId("");
      setMemberSearch("");
      setAmount("");
      setMpesaRef("");
      setContribDate(new Date().toISOString().slice(0, 10));
      setPaymentMethod("mpesa");
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: [...CONTRIBUTIONS_REVIEW_KEY] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    logOnBehalfMutation.mutate();
  };

  const setStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      row,
    }: {
      id: string;
      status: "confirmed" | "rejected";
      row?: ContributionRow;
    }) => {
      const { error } = await supabase
        .from("contributions")
        .update({
          status,
          confirmed_by: user.id,
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;

      const profile = row ? profileOf(row) : null;
      if (profile?.email) {
        void notifyContributionReview({
          memberEmail: profile.email,
          memberName: profile.full_name ?? undefined,
          amount: Number(row?.amount ?? 0),
          status,
          method: row?.method,
          reference: row?.reference ?? undefined,
        }).catch((e) => console.warn("Failed sending notification", e));
      }
    },
    onSuccess: (_result, variables) => {
      toast.success(
        variables.status === "confirmed" ? "Contribution confirmed" : "Contribution rejected",
      );
      void queryClient.invalidateQueries({ queryKey: [...CONTRIBUTIONS_REVIEW_KEY] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingActionId = setStatus.isPending ? setStatus.variables?.id : undefined;

  if (!canReview) {
    return (
      <div className="text-sm text-muted-foreground">
        Only the treasurer or admin can review contributions.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">Contributions Review</h2>
          <p className="text-sm text-muted-foreground">
            {counts.pending} pending confirmation
            {isFetching ? " · refreshing…" : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {r.isAdmin && (
            <Button variant="outline" onClick={() => setImportDialogOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Bulk Import CSV
            </Button>
          )}
          {canReview && (
            <Button onClick={() => setLogDialogOpen(true)} className="gap-2">
              <PlusCircle className="h-4 w-4" />
              Log Contribution for Member
            </Button>
          )}
        </div>
      </div>

      <Tabs value={statusTab} onValueChange={(value) => setStatusTab(value as ContributionStatus)}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({counts.pending})</TabsTrigger>
          <TabsTrigger value="confirmed">Confirmed ({counts.confirmed})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({counts.rejected})</TabsTrigger>
          <TabsTrigger value="all">All ({contributions.length})</TabsTrigger>
        </TabsList>
      </Tabs>

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
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : contributionsError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-destructive">
                  Could not load contributions: {contributionsError.message}
                </TableCell>
              </TableRow>
            ) : visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {statusTab === "pending"
                    ? "No contributions awaiting confirmation."
                    : "No contributions to show."}
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((row) => {
                const profile = profileOf(row);
                const busy = pendingActionId === row.id;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{profile?.full_name ?? "Unknown"}</div>
                        {row.on_behalf_of === true && (
                          <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0">
                            Officer Entry
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {profile?.email ?? profile?.phone_number ?? "No contact on file"}
                      </div>
                    </TableCell>
                    <TableCell>{new Date(row.contributed_on).toLocaleDateString()}</TableCell>
                    <TableCell className="capitalize">{row.method}</TableCell>
                    <TableCell className="text-muted-foreground">{row.reference ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          row.status === "confirmed"
                            ? "bg-success text-success-foreground"
                            : row.status === "rejected"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-gold/20 text-gold"
                        }
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {fmt(Number(row.amount))}
                    </TableCell>
                    <TableCell>
                      {row.status === "pending" && canReview && (
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Confirm contribution"
                            disabled={setStatus.isPending}
                            onClick={() =>
                              setStatus.mutate({ id: row.id, status: "confirmed", row })
                            }
                          >
                            <Check
                              className={
                                busy ? "h-4 w-4 animate-pulse text-success" : "h-4 w-4 text-success"
                              }
                            />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Reject contribution"
                            disabled={setStatus.isPending}
                            onClick={() =>
                              setStatus.mutate({ id: row.id, status: "rejected", row })
                            }
                          >
                            <X
                              className={
                                busy
                                  ? "h-4 w-4 animate-pulse text-destructive"
                                  : "h-4 w-4 text-destructive"
                              }
                            />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* ── Log Contribution for Member Dialog ───────── */}
      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleLogSubmit}>
            <DialogHeader>
              <DialogTitle>Log Contribution for Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="member-select">Member *</Label>
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search member by name or phone..."
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      className="pl-8 text-xs"
                    />
                  </div>
                  <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                    <SelectTrigger id="member-select">
                      <SelectValue placeholder="Select an approved member" />
                    </SelectTrigger>
                    <SelectContent className="max-h-56">
                      {filteredMembers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.full_name ?? "Member"} ({m.phone_number || "No phone"})
                        </SelectItem>
                      ))}
                      {filteredMembers.length === 0 && (
                        <div className="p-2 text-xs text-muted-foreground text-center">
                          No matching members found
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="contrib-amount">Amount (KES) *</Label>
                  <Input
                    id="contrib-amount"
                    type="number"
                    min="1"
                    placeholder="e.g. 5000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contrib-date">Date *</Label>
                  <Input
                    id="contrib-date"
                    type="date"
                    value={contribDate}
                    onChange={(e) => setContribDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="mpesa-ref">M-Pesa Ref *</Label>
                  <Input
                    id="mpesa-ref"
                    placeholder="e.g. QWE123456"
                    value={mpesaRef}
                    onChange={(e) => setMpesaRef(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-method">Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger id="payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mpesa">M-Pesa</SelectItem>
                      <SelectItem value="bank">Bank</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contrib-notes">Notes (optional)</Label>
                <Textarea
                  id="contrib-notes"
                  placeholder="Optional notes or details..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLogDialogOpen(false)}
                disabled={logOnBehalfMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={logOnBehalfMutation.isPending}>
                {logOnBehalfMutation.isPending ? "Logging..." : "Log Contribution"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Import CSV Dialog (admin only) ───────── */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Import Contributions from CSV</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Import previously recorded contributions as confirmed officer entries. Downloaded
            template, validate the preview, then import the valid rows.
          </p>
          <ContributionImportPanel
            members={approvedMembers}
            existingRefs={existingRefs}
            officerId={user.id}
            officerRole={currentRole}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Fallback loader used when PostgREST cannot resolve the `profiles` embed
 * (contributions.member_id references auth.users, not public.profiles).
 * Fetches both tables and merges on the client so names still render.
 */
async function fetchContributionsWithMergedProfiles(): Promise<ContributionRow[]> {
  const { data: rows, error } = await supabase
    .from("contributions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const contributionRows = rows ?? [];

  const memberIds = [...new Set(contributionRows.map((row) => row.member_id))];
  if (memberIds.length === 0) return contributionRows;

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone_number")
    .in("id", memberIds);
  if (profilesError) throw profilesError;

  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return contributionRows.map((row) => ({ ...row, profiles: byId.get(row.member_id) ?? null }));
}
