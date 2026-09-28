import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ContributionImportPanel } from "@/components/contributions/ContributionImportPanel";
import { adminAction } from "@/lib/admin-actions";
import { UnauthorizedCard } from "@/components/shared/UnauthorizedCard";
import { useRoles } from "@/hooks/use-roles";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  IMPORTABLE_MEMBER_ROLES,
  LOAN_COLUMNS,
  MEMBER_COLUMNS,
  downloadCsv,
  loanTemplateCsv,
  memberTemplateCsv,
  parseCsvRecords,
  validateLoanRows,
  validateMemberRows,
  type LoanImportRow,
  type MemberImportRow,
  type MemberOption,
} from "@/lib/csv-import";

export const Route = createFileRoute("/_authenticated/data-import")({
  component: Page,
});

type ImportCounts = { imported: number; failed: number; skipped: number };

/** Small shared banner shown after an import run finishes. */
function ResultBanner({ result }: { result: ImportCounts }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/5 p-3 text-sm">
      <CheckCircle2 className="h-4 w-4 text-success" />
      <span>
        Imported {result.imported} · skipped {result.skipped} · failed {result.failed}
      </span>
    </div>
  );
}

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);

  const { data: members = [] } = useQuery({
    queryKey: ["import-member-options"],
    enabled: r.isAdmin,
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

  const { data: existingRefs = [] } = useQuery({
    queryKey: ["import-existing-refs"],
    enabled: r.isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("contributions").select("reference");
      if (error) throw error;
      return (data ?? []).map((row) => row.reference ?? "").filter((ref) => ref !== "");
    },
  });

  if (r.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  if (!r.isAdmin) {
    return <UnauthorizedCard message="This page is restricted to administrators." />;
  }

  const officerRole = "admin";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h2 className="font-serif text-2xl font-semibold text-primary">Data Import</h2>
        <p className="text-sm text-muted-foreground">Import existing foundation records.</p>
      </div>

      <Tabs defaultValue="members" className="space-y-4">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="contributions">Contributions</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <Card>
            <CardContent className="pt-6">
              <MembersImport members={members} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contributions">
          <Card>
            <CardContent className="pt-6">
              <ContributionImportPanel
                members={members}
                existingRefs={existingRefs}
                officerId={user.id}
                officerRole={officerRole}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="loans">
          <Card>
            <CardContent className="pt-6">
              <LoansImport members={members} officerId={user.id} officerRole={officerRole} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─────────────────────────── Members import ─────────────────────────── */

function MembersImport({ members }: { members: MemberOption[] }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<MemberImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportCounts | null>(null);

  const validRows = rows.filter((row) => row.errors.length === 0);
  const skipped = rows.length - validRows.length;

  const reset = () => {
    setRows([]);
    setFileName("");
    setResult(null);
    setProgress({ done: 0, total: 0 });
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a .csv file.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("Could not read that file.");
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const { headers, records } = parseCsvRecords(text);
      if (records.length === 0) {
        toast.error("That CSV has no data rows.");
        return;
      }
      const missing = MEMBER_COLUMNS.filter((column) => !headers.includes(column));
      if (missing.length > 0) {
        toast.error(`Missing column(s): ${missing.join(", ")}`);
        return;
      }
      setFileName(file.name);
      setResult(null);
      setRows(
        validateMemberRows(
          records,
          members.map((m) => m.phone_number ?? ""),
        ),
      );
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: validRows.length });
    let imported = 0;
    let failed = 0;

    for (let i = 0; i < validRows.length; i += 1) {
      const row = validRows[i];
      try {
        const response = await adminAction({
          action: "create_manual_member",
          fullName: row.full_name,
          phoneNumber: row.phone_number,
          email: row.email ? row.email : null,
          role: row.role,
        });
        if (response.warning) toast.warning(response.warning);
        imported += 1;
      } catch (e) {
        failed += 1;
        console.warn("Member import row failed", row.line, e);
      }
      setProgress({ done: i + 1, total: validRows.length });
    }

    setResult({ imported, skipped, failed });
    setImporting(false);
    if (imported > 0) {
      toast.success(`Imported ${imported} member${imported === 1 ? "" : "s"}.`);
      qc.invalidateQueries({ queryKey: ["import-member-options"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["profiles"] });
    }
    if (failed > 0) toast.error(`${failed} member row(s) failed to import.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            downloadCsv("members-import-template.csv", memberTemplateCsv());
            toast.success("Template downloaded.");
          }}
        >
          <Download className="mr-2 h-4 w-4" /> Download Template
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" /> Choose CSV
        </Button>
        {fileName && (
          <span className="text-xs text-muted-foreground">
            <FileSpreadsheet className="mr-1 inline h-3.5 w-3.5" />
            {fileName}
          </span>
        )}
        {(rows.length > 0 || result) && (
          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={importing}>
            Clear
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Columns: <span className="font-mono">{MEMBER_COLUMNS.join(", ")}</span>. Roles allowed:{" "}
        <span className="font-mono">{IMPORTABLE_MEMBER_ROLES.join(", ")}</span>. Phone numbers must
        not already belong to a member.
      </p>

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className="bg-success text-success-foreground">{validRows.length} valid</Badge>
            <Badge className="bg-destructive/10 text-destructive">{skipped} skipped</Badge>
            {importing && (
              <span className="text-muted-foreground">
                Importing {progress.done}/{progress.total}…
              </span>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Line</TableHead>
                  <TableHead>Full name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell className="text-xs text-muted-foreground">{row.line}</TableCell>
                    <TableCell className="text-sm">{row.full_name || "—"}</TableCell>
                    <TableCell className="text-xs">{row.phone_number}</TableCell>
                    <TableCell className="text-xs">{row.email || "—"}</TableCell>
                    <TableCell className="text-xs capitalize">
                      {row.role.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      {row.errors.length > 0 ? (
                        <Badge className="bg-destructive/10 text-destructive">
                          {row.errors[0]}
                        </Badge>
                      ) : (
                        <Badge className="bg-success text-success-foreground">Ready</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {result && <ResultBanner result={result} />}

          <Button
            type="button"
            onClick={handleImport}
            disabled={importing || validRows.length === 0}
          >
            <Upload className="mr-2 h-4 w-4" />
            {importing
              ? `Importing ${progress.done}/${progress.total}…`
              : `Import ${validRows.length} Member${validRows.length === 1 ? "" : "s"}`}
          </Button>
        </>
      )}
    </div>
  );
}

/* ──────────────────────────── Loans import ──────────────────────────── */

function LoansImport({
  members,
  officerId,
  officerRole,
}: {
  members: MemberOption[];
  officerId: string;
  officerRole: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<LoanImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportCounts | null>(null);

  const validRows = rows.filter((row) => row.errors.length === 0);
  const skipped = rows.length - validRows.length;

  const reset = () => {
    setRows([]);
    setFileName("");
    setResult(null);
    setProgress({ done: 0, total: 0 });
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a .csv file.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("Could not read that file.");
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const { headers, records } = parseCsvRecords(text);
      if (records.length === 0) {
        toast.error("That CSV has no data rows.");
        return;
      }
      const missing = LOAN_COLUMNS.filter((column) => !headers.includes(column));
      if (missing.length > 0) {
        toast.error(`Missing column(s): ${missing.join(", ")}`);
        return;
      }
      setFileName(file.name);
      setResult(null);
      setRows(validateLoanRows(records, members));
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: validRows.length });
    let imported = 0;
    let failed = 0;

    for (let i = 0; i < validRows.length; i += 1) {
      const row = validRows[i];
      try {
        // The loans table has no disbursed_date column: an imported date is stored on
        // created_at (and decision_at for approved rows). Approved imports first insert as
        // submitted, then transition to approved so the UPDATE trigger creates the schedule.
        const disbursedIso = row.disbursed_date
          ? new Date(`${row.disbursed_date}T09:00:00Z`).toISOString()
          : null;
        const purpose = row.notes ? `${row.purpose}\n\nImported note: ${row.notes}` : row.purpose;

        const insert: {
          member_id: string;
          loan_type: "project" | "emergency";
          amount: number;
          purpose: string;
          repayment_months: number;
          status: string;
          entered_by: string;
          entered_by_role: string;
          on_behalf_of: boolean;
          created_at?: string;
          decision_at?: string;
        } = {
          member_id: row.memberId as string,
          loan_type: row.loan_type === "emergency" ? "emergency" : "project",
          amount: Number(row.amount),
          purpose,
          repayment_months: Number(row.repayment_months),
          // The deployed repayment-schedule trigger fires on UPDATE OF status, not INSERT.
          status: "submitted",
          entered_by: officerId,
          entered_by_role: officerRole,
          on_behalf_of: true,
        };
        if (disbursedIso) insert.created_at = disbursedIso;
        if (row.status === "approved" && disbursedIso) insert.decision_at = disbursedIso;

        const { data: created, error } = await supabase
          .from("loans")
          .insert(insert)
          .select("id")
          .single();
        if (error) throw error;
        if (row.status === "approved") {
          const { error: approvalError } = await supabase
            .from("loans")
            .update({ status: "approved", decision_at: disbursedIso ?? new Date().toISOString() })
            .eq("id", created.id);
          if (approvalError) {
            // Admins can delete loans; don't leave a submitted duplicate on retry.
            const { error: cleanupError } = await supabase
              .from("loans")
              .delete()
              .eq("id", created.id);
            if (cleanupError) console.error("Loan import cleanup failed", created.id, cleanupError);
            throw approvalError;
          }
        }
        imported += 1;
      } catch (e) {
        failed += 1;
        console.warn("Loan import row failed", row.line, e);
      }
      setProgress({ done: i + 1, total: validRows.length });
    }

    setResult({ imported, skipped, failed });
    setImporting(false);
    if (imported > 0) {
      toast.success(`Imported ${imported} loan${imported === 1 ? "" : "s"}.`);
      qc.invalidateQueries({ queryKey: ["loans"] });
    }
    if (failed > 0) toast.error(`${failed} loan row(s) failed to import.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            downloadCsv("loans-import-template.csv", loanTemplateCsv());
            toast.success("Template downloaded.");
          }}
        >
          <Download className="mr-2 h-4 w-4" /> Download Template
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" /> Choose CSV
        </Button>
        {fileName && (
          <span className="text-xs text-muted-foreground">
            <FileSpreadsheet className="mr-1 inline h-3.5 w-3.5" />
            {fileName}
          </span>
        )}
        {(rows.length > 0 || result) && (
          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={importing}>
            Clear
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Columns: <span className="font-mono">{LOAN_COLUMNS.join(", ")}</span>. Row status may be{" "}
        <span className="font-mono">submitted</span> or <span className="font-mono">approved</span>;
        approved rows use the existing schedule trigger.
      </p>

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className="bg-success text-success-foreground">{validRows.length} valid</Badge>
            <Badge className="bg-destructive/10 text-destructive">{skipped} skipped</Badge>
            {importing && (
              <span className="text-muted-foreground">
                Importing {progress.done}/{progress.total}…
              </span>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Line</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Months</TableHead>
                  <TableHead>Disbursed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Validation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell className="text-xs text-muted-foreground">{row.line}</TableCell>
                    <TableCell className="text-xs">{row.member_phone}</TableCell>
                    <TableCell className="text-right text-sm">{row.amount}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs">{row.purpose}</TableCell>
                    <TableCell className="text-xs capitalize">{row.loan_type}</TableCell>
                    <TableCell className="text-xs">{row.repayment_months}</TableCell>
                    <TableCell className="text-xs">{row.disbursed_date || "—"}</TableCell>
                    <TableCell className="text-xs capitalize">{row.status}</TableCell>
                    <TableCell>
                      {row.errors.length > 0 ? (
                        <Badge className="bg-destructive/10 text-destructive">
                          {row.errors[0]}
                        </Badge>
                      ) : (
                        <Badge className="bg-success text-success-foreground">Ready</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {result && <ResultBanner result={result} />}

          <Button
            type="button"
            onClick={handleImport}
            disabled={importing || validRows.length === 0}
          >
            <Upload className="mr-2 h-4 w-4" />
            {importing
              ? `Importing ${progress.done}/${progress.total}…`
              : `Import ${validRows.length} Loan${validRows.length === 1 ? "" : "s"}`}
          </Button>
        </>
      )}
    </div>
  );
}
