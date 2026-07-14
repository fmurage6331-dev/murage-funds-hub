import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, X, Check, Ban } from "lucide-react";
import { toast } from "sonner";
import { useRoles } from "@/hooks/use-roles";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/users")({
  component: Page,
});

type Role = Database["public"]["Enums"]["app_role"];
const ROLES: Role[] = ["admin", "chairman", "treasurer", "secretary", "assistant_secretary", "board_member", "member"];

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const qc = useQueryClient();

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

  const pending = profiles.filter((p) => p.status === "pending");
  const users = profiles.filter((p) => p.status === "approved");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users-with-roles"] });

  const approveUser = useMutation({
    mutationFn: async (userId: string) => {
      const { error: profErr } = await supabase
        .from("profiles")
        .update({ status: "approved" })
        .eq("id", userId);
      if (profErr) throw profErr;

  const { error: roleErr } = await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role: "member" }, { onConflict: "user_id,role", ignoreDuplicates: true });
      if (roleErr) throw roleErr;
    },
    onSuccess: () => { toast.success("Member approved"); invalidate(); },
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
    onSuccess: () => { toast.success("Signup rejected"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addRole = useMutation({
    mutationFn: async ({ user_id, role }: { user_id: string; role: Role }) => {
      const { error } = await supabase.from("user_roles").insert({ user_id, role });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role granted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role removed"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!r.isAdmin) return <div className="text-sm text-muted-foreground">Admins only.</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h2 className="font-serif text-2xl font-semibold text-primary">Users & Roles</h2>
        <p className="text-sm text-muted-foreground">Approve new signups, then grant officer, board, or admin roles.</p>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Pending Approval <Badge variant="secondary">{pending.length}</Badge>
          </h3>
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
                {pending.map((p) => (
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
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Approved Members</h3>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="w-64">Grant role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : users.map((u) => {
                const held = new Set(u.roles.map((x) => x.role));
                const available = ROLES.filter((rl) => !held.has(rl));
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((rr) => (
                          <Badge key={rr.id} variant="secondary" className="gap-1">
                            <span className="capitalize">{rr.role.replace(/_/g, " ")}</span>
                            {!(rr.role === "admin" && u.id === user.id) && (
                              <button onClick={() => removeRole.mutate(rr.id)} className="ml-1 text-muted-foreground hover:text-destructive">
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </Badge>
                        ))}
                        {u.roles.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {available.map((rl) => (
                          <Button key={rl} size="sm" variant="outline" className="h-7 text-xs capitalize"
                            onClick={() => addRole.mutate({ user_id: u.id, role: rl })}>
                            <Plus className="mr-1 h-3 w-3" /> {rl.replace(/_/g, " ")}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
