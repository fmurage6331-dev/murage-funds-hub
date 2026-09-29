import { adminAction } from "@/lib/admin-actions";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Phone,
  Mail,
  UserCircle,
  UserPlus,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { UnauthorizedCard } from "@/components/shared/UnauthorizedCard";
import { useRoles } from "@/hooks/use-roles";
import { DEFAULT_MEMBER_PASSWORD } from "@/lib/phoneUtils";
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

/** Member an administrator is about to reset, as named in the confirmation dialog. */
interface ResetTarget {
  id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
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
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);

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

  // ── Add Manual Member Dialog State ────────────
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addFullName, setAddFullName] = useState("");
  const [addPhoneNumber, setAddPhoneNumber] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addRoleVal, setAddRoleVal] = useState<string>("member");

  const createMemberMutation = useMutation({
    mutationFn: async (vars: {
      fullName: string;
      phoneNumber: string;
      email: string | null;
      role: string;
    }) => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (error) throw error;
      if (!session) throw new Error("Please sign in again.");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-actions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            action: "create_manual_member",
            fullName: vars.fullName,
            phoneNumber: vars.phoneNumber,
            email: vars.email,
            role: vars.role,
          }),
        },
      );

      let result: { success?: boolean; error?: string; memberId?: string } = {};
      try {
        result = (await response.json()) as {
          success?: boolean;
          error?: string;
          memberId?: string;
        };
      } catch {
        result = {};
      }
      if (!response.ok || result.success !== true) {
        throw new Error(result.error ?? "Failed to add member");
      }
      return result;
    },
    onSuccess: (_, vars) => {
      toast.success(
        `${vars.fullName} added successfully! They sign in with ${
          vars.email ?? vars.phoneNumber
        } and the default password ${DEFAULT_MEMBER_PASSWORD}.`,
      );
      setAddMemberOpen(false);
      setAddFullName("");
      setAddPhoneNumber("");
      setAddEmail("");
      setAddRoleVal("member");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleCreateMemberSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addFullName.trim() || !addPhoneNumber.trim()) {
      toast.error("Full Name and Phone Number are required.");
      return;
    }
    createMemberMutation.mutate({
      fullName: addFullName.trim(),
      phoneNumber: addPhoneNumber.trim(),
      email: addEmail.trim() ? addEmail.trim() : null,
      role: addRoleVal,
    });
  };

  // ── Web App Mutations ─────────────────────────
  const approveUser = useMutation({
    mutationFn: (userId: string) =>
      adminAction({ action: "approve_member", userId, role: "member" }),
    onSuccess: () => {
      toast.success("Member approved");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectUser = useMutation({
    mutationFn: (userId: string) => adminAction({ action: "reject_member", userId }),
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

  /**
   * Put a member back on the default password (12345678). The Edge Function re-arms
   * `profiles.is_default_password` so the member is prompted to change it at next sign-in, writes
   * the append-only audit entry, and emails the member when they have a real mailbox.
   */
  const resetPassword = useMutation({
    mutationFn: (target: ResetTarget) =>
      adminAction({ action: "resetMemberPassword", userId: target.id }),
    onSuccess: (result, target) => {
      const name = target.full_name ?? target.phone_number ?? target.email ?? "Member";
      toast.success(`${name}'s password has been reset to ${DEFAULT_MEMBER_PASSWORD}`);
      if (result.warning) toast.warning(result.warning);
      setResetTarget(null);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Bot Registration Mutations ────────────────
  const approveBotRegistration = useMutation({
    mutationFn: (reg: PendingRegistration) =>
      adminAction({ action: "approve_bot_registration", registrationId: reg.id }),
    onSuccess: (result, reg) => {
      toast.success(
        `${reg.full_name ?? "Member"} approved! ${reg.email ? "Password reset email sent." : "Bot access granted."}`,
      );
      if (result.warning) toast.warning(result.warning);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectBotRegistration = useMutation({
    mutationFn: ({ reg, reason }: { reg: PendingRegistration; reason: string }) =>
      adminAction({
        action: "reject_bot_registration",
        registrationId: reg.id,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success("Registration rejected.");
      setRejectTarget(null);
      setRejectReason("");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (r.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  if (!r.isAdmin) {
    return <UnauthorizedCard message="This page is restricted to administrators." />;
  }

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
        <TabsContent value="approved" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {webUsers.length} active registered {webUsers.length === 1 ? "member" : "members"}.
            </p>
            <Button onClick={() => setAddMemberOpen(true)} className="gap-2">
              <UserPlus className="h-4 w-4" />
              Add Member
            </Button>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>KDPA Consent & Retention</TableHead>
                  <TableHead className="w-56">Grant Role</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
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
                            {u.is_default_password && (
                              <Badge
                                variant="secondary"
                                className="gap-1 bg-amber-100 text-[10px] py-0 px-1 text-amber-800"
                              >
                                <KeyRound className="h-3 w-3" />
                                Default password
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {u.email ?? "Signs in with phone number"}
                          </div>
                          {u.phone_number && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {u.phone_number}
                            </div>
                          )}
                          <Link
                            to="/member-profile/$memberId"
                            params={{ memberId: u.id }}
                            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <UserCircle className="h-3.5 w-3.5" /> View Profile
                          </Link>
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
                          <div className="flex items-center justify-end gap-1">
                            {r.isAdmin && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                                      aria-label={`Reset ${u.full_name ?? "member"}'s password to the default`}
                                      disabled={resetPassword.isPending}
                                      onClick={() =>
                                        setResetTarget({
                                          id: u.id,
                                          full_name: u.full_name,
                                          email: u.email,
                                          phone_number: u.phone_number,
                                        })
                                      }
                                    >
                                      <KeyRound className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Reset password to default</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            <KdpaUserTools userProfile={u} />
                          </div>
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
                    Account: <span className="font-bold text-sm">7989164</span>
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
      {/* ── Reset Password Dialog ───────────────────── */}
      <AlertDialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Password</AlertDialogTitle>
            <AlertDialogDescription>
              Reset{" "}
              <span className="font-medium text-foreground">
                {resetTarget?.full_name ??
                  resetTarget?.phone_number ??
                  resetTarget?.email ??
                  "this member"}
              </span>
              's password to the default password ({DEFAULT_MEMBER_PASSWORD})? They will be prompted
              to change it on next login.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetPassword.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={resetPassword.isPending}
              onClick={() => {
                if (resetTarget) resetPassword.mutate(resetTarget);
              }}
            >
              {resetPassword.isPending ? "Resetting…" : "Reset Password"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Add Member Dialog ──────────────────────── */}
      <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <form onSubmit={handleCreateMemberSubmit}>
            <DialogHeader>
              <DialogTitle>Add Member Manually</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="manual-full-name">Full Name *</Label>
                <Input
                  id="manual-full-name"
                  placeholder="e.g. Jane Doe"
                  value={addFullName}
                  onChange={(e) => setAddFullName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="manual-phone">Phone Number *</Label>
                <Input
                  id="manual-phone"
                  placeholder="e.g. 0712345678"
                  value={addPhoneNumber}
                  onChange={(e) => setAddPhoneNumber(e.target.value)}
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  e.g. 0712345678 · WhatsApp/SMS bot · their sign-in ID if they have no email
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="manual-email">Email (optional)</Label>
                <Input
                  id="manual-email"
                  type="email"
                  placeholder="e.g. member@example.com"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave blank if the member has no email — they sign in with their phone number
                  instead
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="manual-role">Role *</Label>
                <Select value={addRoleVal} onValueChange={setAddRoleVal}>
                  <SelectTrigger id="manual-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="board_member">Board Member</SelectItem>
                    <SelectItem value="secretary">Secretary</SelectItem>
                    <SelectItem value="assistant_secretary">Assistant Secretary</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <p className="rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                The member is issued the default password{" "}
                <span className="font-mono">{DEFAULT_MEMBER_PASSWORD}</span> and is prompted to
                change it after signing in.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddMemberOpen(false)}
                disabled={createMemberMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMemberMutation.isPending}>
                {createMemberMutation.isPending ? "Adding..." : "Add Member"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
