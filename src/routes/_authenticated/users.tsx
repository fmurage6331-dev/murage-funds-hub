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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  X,
  Check,
  Ban,
  ShieldCheck,
  MessageSquare,
  Smartphone,
  Mail,
  Phone,
} from "lucide-react";
import { toast } from "sonner";
import { useRoles } from "@/hooks/use-roles";
import { useState } from "react";
import type { Database } from "@/integrations/supabase/types";
import { KdpaUserTools } from "@/components/users/KdpaUserTools";

export const Route = createFileRoute("/_authenticated/users")({
  component: Page,
});

type Role = Database["public"]["Enums"]["app_role"];
const ROLES: Role[] = [
  "admin",
  "chairman",
  "treasurer",
  "secretary",
  "assistant_secretary",
  "board_member",
  "member",
];

// ── Types ─────────────────────────────────────────
interface PendingRegistration {
  id: string;
  phone_number: string;
  full_name: string | null;
  email: string | null;
  requested_role: string;
  registration_channel: string;
  status: string;
  created_at: string;
}

// ── Role Label Helper ─────────────────────────────
function roleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Channel Badge ─────────────────────────────────
function ChannelBadge({ channel }: { channel: string }) {
  if (channel === "whatsapp") {
    return (
      <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800 border-green-200">
        <MessageSquare className="h-3 w-3" />
        WhatsApp
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-800 border-blue-200">
      <Smartphone className="h-3 w-3" />
      SMS
    </Badge>
  );
}

// ── Main Page ─────────────────────────────────────
function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const qc = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<PendingRegistration | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // ── Web App Users Query ───────────────────────
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["users-with-roles"],
    enabled: r.isAdmin,
    queryFn: async () => {
      const [profRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("user_roles").select("*"),
      ]);
      const profs = profRes.data ?? [];
      const roles = rolesRes.data ?? [];
      return profs.map((p) => ({
        ...p,
        roles: roles.filter((rr) => rr.user_id === p.id),
      }));
    },
  });

  // ── Bot Pending Registrations Query ───────────
  const { data: botPending = [] } = useQuery({
    queryKey: ["bot-pending-registrations"],
    enabled: r.isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_registrations")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PendingRegistration[];
    },
  });

  const webPending = profiles.filter((p) => p.status === "pending");
  const webUsers = profiles.filter((p) => p.status === "approved");

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["users-with-roles"] });
    qc.invalidateQueries({ queryKey: ["bot-pending-registrations"] });
  };

  // ── Web App Mutations ─────────────────────────
  const approveUser = useMutation({
    mutationFn: async (userId: string) => {
      const { error: profErr } = await supabase
        .from("profiles")
        .update({ status: "approved" })
        .eq("id", userId);
      if (profErr) throw profErr;
      const { error: roleErr } = await supabase
        .from("user_roles")
        .upsert(
          { user_id: userId, role: "member" },
          { onConflict: "user_id,role", ignoreDuplicates: true },
        );
      if (roleErr) throw roleErr;
    },
    onSuccess: () => {
      toast.success("Member approved");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectUser = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("profiles")
        .update({ status: "rejected" })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Signup rejected");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addRole = useMutation({
    mutationFn: async ({ user_id, role }: { user_id: string; role: Role }) => {
      const { error } = await supabase.from("user_roles").insert({ user_id, role });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role granted");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role removed");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Bot Registration Mutations ────────────────
  const approveBotRegistration = useMutation({
    mutationFn: async (reg: PendingRegistration) => {
      // Update pending_registrations status
      const { error: regErr } = await supabase
        .from("pending_registrations")
        .update({
          status: "approved",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          invite_sent: true,
          invite_sent_at: new Date().toISOString(),
        })
        .eq("id", reg.id);
      if (regErr) throw regErr;

      if (reg.email) {
        // Full member — create profile and send magic link
        const { data: authData, error: authErr } = await supabase.auth.admin.inviteUserByEmail(
          reg.email,
          {
            data: {
              full_name: reg.full_name,
              phone_number: reg.phone_number,
            },
          },
        );
        if (authErr) throw authErr;

        if (authData?.user) {
          // Create profile
          await supabase.from("profiles").upsert({
            id: authData.user.id,
            full_name: reg.full_name,
            email: reg.email,
            phone_number: reg.phone_number,
            status: "approved",
            phone_only_member: false,
            whatsapp_opt_in: true,
            consent_given: true,
            consent_timestamp: new Date().toISOString(),
            data_retention_until: new Date(
              Date.now() + 7 * 365 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          });

          // Assign role
          await supabase.from("user_roles").insert({
            user_id: authData.user.id,
            role: reg.requested_role as Role,
          });
        }
      } else {
        // Phone only member — create profile without auth user
        await supabase.from("profiles").insert({
          id: crypto.randomUUID(),
          full_name: reg.full_name,
          email: null,
          phone_number: reg.phone_number,
          status: "approved",
          phone_only_member: true,
          whatsapp_opt_in: true,
          consent_given: true,
          consent_timestamp: new Date().toISOString(),
          data_retention_until: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
    },
    onSuccess: (_, reg) => {
      toast.success(
        `${reg.full_name ?? "Member"} approved! ${reg.email ? "Magic link sent." : "Bot access granted."}`,
      );
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectBotRegistration = useMutation({
    mutationFn: async ({ reg, reason }: { reg: PendingRegistration; reason: string }) => {
      const { error } = await supabase
        .from("pending_registrations")
        .update({
          status: "rejected",
          admin_notes: reason,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", reg.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registration rejected and applicant notified.");
      setRejectTarget(null);
      setRejectReason("");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!r.isAdmin) return <div className="text-sm text-muted-foreground">Admins only.</div>;

  const totalPending = webPending.length + botPending.length;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div>
        <h2 className="font-serif text-2xl font-semibold text-primary">Users & Roles</h2>
        <p className="text-sm text-muted-foreground">
          Approve new signups, manage roles, and handle WhatsApp/SMS registrations.
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="approved">
        <TabsList>
          <TabsTrigger value="approved">Approved Members ({webUsers.length})</TabsTrigger>
          <TabsTrigger value="pending">
            Pending Approvals
            {totalPending > 0 && (
              <Badge variant="destructive" className="ml-2 text-[10px] px-1.5">
                {totalPending}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="bot">
            Bot Registrations
            {botPending.length > 0 && (
              <Badge variant="destructive" className="ml-2 text-[10px] px-1.5">
                {botPending.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Approved Members ─────────────── */}
        <TabsContent value="approved" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>KDPA Consent & Retention</TableHead>
                  <TableHead className="w-56">Grant Role</TableHead>
                  <TableHead className="w-12 text-right">Data Tools</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : webUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No approved members yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  webUsers.map((u) => {
                    const held = new Set(u.roles.map((x) => x.role));
                    const available = ROLES.filter((rl) => !held.has(rl));
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="font-medium flex items-center gap-1.5">
                            {u.full_name ?? "—"}
                            {u.is_anonymized && (
                              <Badge variant="destructive" className="text-[10px] py-0 px-1">
                                Anonymized
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                          {u.phone_number && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {u.phone_number}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {u.roles.map((rr) => (
                              <Badge key={rr.id} variant="secondary" className="gap-1">
                                <span className="capitalize">{rr.role.replace(/_/g, " ")}</span>
                                {!(rr.role === "admin" && u.id === user.id) && (
                                  <button
                                    onClick={() => removeRole.mutate(rr.id)}
                                    className="ml-1 text-muted-foreground hover:text-destructive"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </Badge>
                            ))}
                            {u.roles.length === 0 && (
                              <span className="text-xs text-muted-foreground">None</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {u.consent_given ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                                Consent v{u.consent_version || "1.0"}
                              </span>
                              {u.data_retention_until && (
                                <div className="text-[10px] text-muted-foreground">
                                  Retain until:{" "}
                                  {new Date(u.data_retention_until).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-amber-600 text-[11px]">Legacy / No consent</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {available.map((rl) => (
                              <Button
                                key={rl}
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs capitalize"
                                onClick={() =>
                                  addRole.mutate({
                                    user_id: u.id,
                                    role: rl,
                                  })
                                }
                              >
                                <Plus className="mr-1 h-3 w-3" />
                                {rl.replace(/_/g, " ")}
                              </Button>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <KdpaUserTools userProfile={u} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ── Tab 2: Web App Pending ──────────────── */}
        <TabsContent value="pending" className="mt-4">
          {webPending.length === 0 ? (
            <Card className="py-12 text-center text-muted-foreground">
              ✅ No pending web app signups.
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead className="w-40 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {webPending.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium">{p.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{p.email}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={approveUser.isPending}
                            onClick={() => approveUser.mutate(p.id)}
                          >
                            <Check className="mr-1 h-3 w-3" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            disabled={rejectUser.isPending}
                            onClick={() => rejectUser.mutate(p.id)}
                          >
                            <Ban className="mr-1 h-3 w-3" /> Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* ── Tab 3: Bot Pending Registrations ────── */}
        <TabsContent value="bot" className="mt-4 space-y-4">
          {/* Payment Info Card */}
          <Card className="p-4 bg-emerald-50 border-emerald-200">
            <div className="flex items-start gap-3">
              <div className="text-2xl">💳</div>
              <div className="space-y-1">
                <p className="font-semibold text-emerald-900 text-sm">M-Pesa Payment Details</p>
                <div className="text-xs text-emerald-800 space-y-0.5">
                  <p>Bank: KCB Bank Kenya</p>
                  <p>
                    Paybill: <span className="font-bold text-sm">522522</span>
                  </p>
                  <p>
                    Account: <span className="font-bold text-sm">798164</span>
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {botPending.length === 0 ? (
            <Card className="py-12 text-center text-muted-foreground">
              ✅ No pending WhatsApp/SMS registrations.
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Applicant</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Access Type</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead className="text-right w-44">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {botPending.map((reg) => (
                    <TableRow key={reg.id}>
                      <TableCell>
                        <div className="font-medium">{reg.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {reg.phone_number}
                        </div>
                        {reg.email && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {reg.email}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {roleLabel(reg.requested_role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {reg.email ? (
                          <Badge
                            variant="secondary"
                            className="gap-1 bg-purple-100 text-purple-800"
                          >
                            <Mail className="h-3 w-3" />
                            Full Access
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="gap-1 bg-orange-100 text-orange-800"
                          >
                            <Smartphone className="h-3 w-3" />
                            Phone Only
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <ChannelBadge channel={reg.registration_channel} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(reg.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                            disabled={approveBotRegistration.isPending}
                            onClick={() => approveBotRegistration.mutate(reg)}
                          >
                            <Check className="mr-1 h-3 w-3" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => {
                              setRejectTarget(reg);
                              setRejectReason("");
                            }}
                          >
                            <Ban className="mr-1 h-3 w-3" />
                            Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Reject Dialog ───────────────────────────── */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Registration</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Rejecting registration for{" "}
              <span className="font-medium text-foreground">
                {rejectTarget?.full_name ?? rejectTarget?.phone_number}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              Please provide a reason. The applicant will be notified via{" "}
              {rejectTarget?.registration_channel}.
            </p>
            <Textarea
              placeholder="Reason for rejection..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectBotRegistration.isPending}
              onClick={() => {
                if (rejectTarget) {
                  rejectBotRegistration.mutate({
                    reg: rejectTarget,
                    reason: rejectReason,
                  });
                }
              }}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
