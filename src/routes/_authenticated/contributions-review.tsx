/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { useState, useMemo } from "react";

export const Route = createFileRoute("/_authenticated/contributions-review")({
  component: Page,
});

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const qc = useQueryClient();

  // Log on behalf dialog state
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [mpesaRef, setMpesaRef] = useState("");
  const [contribDate, setContribDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState("mpesa");
  const [notes, setNotes] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["contribs", "all"],
    enabled: (r.isAdmin || r.isTreasurer),
    queryFn: async () => {
      const { data } = await supabase
        .from("contributions")
        .select("*, profiles:member_id(full_name, email)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Approved members query for searchable select
  const { data: approvedMembers = [] } = useQuery({
    queryKey: ["approved-members-for-officer-entry"],
    enabled: (r.isAdmin || r.isTreasurer),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone_number, email")
        .eq("status", "approved")
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

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

  // References already on record, used to skip duplicate M-Pesa refs on import
  const existingRefs = useMemo(
    () => rows.map((row) => row.reference ?? "").filter((ref) => ref !== ""),
    [rows],
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
      qc.invalidateQueries({ queryKey: ["contribs"] });
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
      row?: any;
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

      if (row?.profiles?.email) {
        notifyContributionReview({
          memberEmail: row.profiles.email,
          memberName: row.profiles.full_name,
          amount: Number(row.amount),
          status,
          method: row.method,
          reference: row.reference,
        }).catch((e) => console.warn("Failed sending notification", e));
      }
    },
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["contribs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!(r.isAdmin || r.isTreasurer)) {
    return (
      <div className="text-sm text-muted-foreground">
        Only the treasurer or admin can review contributions.
      </div>
    );
  }

  const pending = rows.filter((x) => x.status === "pending");

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">Contributions Review</h2>
          <p className="text-sm text-muted-foreground">{pending.length} pending confirmation.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {r.isAdmin && (
            <Button variant="outline" onClick={() => setImportDialogOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Bulk Import CSV
            </Button>
          )}
          {(r.isAdmin || r.isTreasurer) && (
            <Button onClick={() => setLogDialogOpen(true)} className="gap-2">
              <PlusCircle className="h-4 w-4" />
              Log Contribution for Member
            </Button>
          )}
        </div>
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
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No contributions yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const p = (row as any).profiles;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{p?.full_name ?? "—"}</div>
                        {row.on_behalf_of && (
                          <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0">
                            Officer Entry
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{p?.email}</div>
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
                      {row.status === "pending" && (
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setStatus.mutate({ id: row.id, status: "confirmed", row })
                            }
                          >
                            <Check className="h-4 w-4 text-success" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setStatus.mutate({ id: row.id, status: "rejected", row })
                            }
                          >
                            <X className="h-4 w-4 text-destructive" />
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
