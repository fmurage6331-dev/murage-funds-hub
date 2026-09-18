import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Eye, Search, Lock } from "lucide-react";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated/audit-logs")({
  component: AuditLogsPage,
});

function AuditLogsPage() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);

  const [tableFilter, setTableFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit_logs", tableFilter, actionFilter],
    enabled: r.isAdmin || r.canViewFinancials,
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (tableFilter !== "all") {
        query = query.eq("table_name", tableFilter);
      }
      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!r.isAdmin && !r.canViewFinancials) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Access restricted. You do not have permission to view the audit log.
      </div>
    );
  }

  const filteredLogs = logs.filter((log) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      log.table_name?.toLowerCase().includes(term) ||
      log.action?.toLowerCase().includes(term) ||
      log.performed_by_email?.toLowerCase().includes(term) ||
      log.record_id?.toLowerCase().includes(term) ||
      (log.changed_fields && log.changed_fields.some((f: string) => f.toLowerCase().includes(term)))
    );
  });

  const getActionBadge = (action: string) => {
    switch (action) {
      case "INSERT":
        return (
          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs">
            INSERT
          </Badge>
        );
      case "UPDATE":
        return (
          <Badge className="bg-sky-600 hover:bg-sky-700 text-white font-mono text-xs">UPDATE</Badge>
        );
      case "DELETE":
        return (
          <Badge className="bg-rose-600 hover:bg-rose-700 text-white font-mono text-xs">
            DELETE
          </Badge>
        );
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-primary">
              Immutable Audit Trail
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
              <Lock className="h-3 w-3" /> Append-Only
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Cryptographically sealed and trigger-enforced ledger of all actions on financial and
            loan records.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Filter Audit Events</CardTitle>
          <div className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search actor email, record ID, field..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={tableFilter} onValueChange={setTableFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All tables" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tables</SelectItem>
                <SelectItem value="contributions">contributions</SelectItem>
                <SelectItem value="loans">loans</SelectItem>
                <SelectItem value="transactions">transactions</SelectItem>
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="INSERT">INSERT</SelectItem>
                <SelectItem value="UPDATE">UPDATE</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">Timestamp</TableHead>
                  <TableHead className="w-[100px]">Action</TableHead>
                  <TableHead className="w-[130px]">Table</TableHead>
                  <TableHead>Performed By</TableHead>
                  <TableHead>Changed Fields</TableHead>
                  <TableHead className="text-right">Inspection</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      Loading audit entries...
                    </TableCell>
                  </TableRow>
                ) : filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      No audit records found matching your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString("en-KE", {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
                      </TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-primary">
                        {log.table_name}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium text-foreground">
                          {log.performed_by_email || "System / Trigger"}
                        </div>
                        {log.performed_by && (
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {log.performed_by}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.changed_fields && log.changed_fields.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {log.changed_fields.map((f: string) => (
                              <Badge
                                key={f}
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 font-mono"
                              >
                                {f}
                              </Badge>
                            ))}
                          </div>
                        ) : log.action === "INSERT" ? (
                          <span className="text-muted-foreground text-xs italic">
                            Initial record creation
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                              <Eye className="h-3.5 w-3.5" /> View Diff
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2 font-serif">
                                <ShieldCheck className="h-5 w-5 text-primary" />
                                Audit Event Detail ({log.table_name} • {log.action})
                              </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-2 text-xs">
                              <div className="grid grid-cols-2 gap-2 rounded bg-muted/40 p-3">
                                <div>
                                  <span className="text-muted-foreground">Record ID:</span>
                                  <span className="ml-1 font-mono font-semibold">
                                    {log.record_id}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Timestamp:</span>
                                  <span className="ml-1 font-mono">
                                    {new Date(log.created_at).toISOString()}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Actor:</span>
                                  <span className="ml-1 font-mono font-medium">
                                    {log.performed_by_email || "System"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Actor UUID:</span>
                                  <span className="ml-1 font-mono">
                                    {log.performed_by || "None"}
                                  </span>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <h4 className="font-semibold text-muted-foreground mb-1">
                                    Previous Values (OLD)
                                  </h4>
                                  <pre className="p-3 bg-muted rounded font-mono text-[11px] overflow-x-auto max-h-72">
                                    {log.old_values
                                      ? JSON.stringify(log.old_values, null, 2)
                                      : "None (New insert)"}
                                  </pre>
                                </div>
                                <div>
                                  <h4 className="font-semibold text-muted-foreground mb-1">
                                    New Values (NEW)
                                  </h4>
                                  <pre className="p-3 bg-muted rounded font-mono text-[11px] overflow-x-auto max-h-72">
                                    {log.new_values
                                      ? JSON.stringify(log.new_values, null, 2)
                                      : "None (Deleted record)"}
                                  </pre>
                                </div>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
