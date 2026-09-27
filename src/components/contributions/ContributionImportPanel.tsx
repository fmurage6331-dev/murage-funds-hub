import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  CONTRIBUTION_COLUMNS,
  contributionTemplateCsv,
  downloadCsv,
  parseCsvRecords,
  validateContributionRows,
  type ContributionImportRow,
  type MemberOption,
} from "@/lib/csv-import";

type Props = {
  /** Approved members used for phone matching (phone-only members included). */
  members: MemberOption[];
  /** References already stored, used to skip duplicate M-Pesa refs. */
  existingRefs: string[];
  /** Officer logging the rows, recorded as entered_by / confirmed_by. */
  officerId: string;
  officerRole: string;
};

type ImportResult = { imported: number; skipped: number; failed: number };

const PAYBILL_NUMBER = "522522";

/**
 * Bulk contribution CSV import: template download, FileReader parsing,
 * validation preview and confirmed officer-attributed imports.
 *
 * Shared by the Contributions Review dialog (8D) and the Data Import page (8F).
 */
export function ContributionImportPanel({ members, existingRefs, officerId, officerRole }: Props) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ContributionImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  const validRows = rows.filter((r) => r.errors.length === 0 && !r.duplicate);
  const skippedRows = rows.filter((r) => r.errors.length > 0 || r.duplicate);

  const reset = () => {
    setRows([]);
    setFileName("");
    setResult(null);
    setProgress({ done: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      const missing = CONTRIBUTION_COLUMNS.filter((c) => !headers.includes(c));
      if (missing.length > 0) {
        toast.error(`Missing column(s): ${missing.join(", ")}`);
        return;
      }
      setFileName(file.name);
      setResult(null);
      setRows(validateContributionRows(records, members, existingRefs));
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
        const { error } = await supabase.from("contributions").insert({
          member_id: row.memberId as string,
          amount: Number(row.amount),
          status: "confirmed",
          method: row.method,
          reference: row.mpesa_ref,
          contributed_on: row.date,
          confirmed_by: officerId,
          confirmed_at: new Date().toISOString(),
          entered_by: officerId,
          entered_by_role: officerRole,
          on_behalf_of: true,
          paybill_number: PAYBILL_NUMBER,
          mpesa_transaction_id: row.mpesa_ref,
          notes: row.notes ? row.notes : null,
        });
        if (error) throw error;
        imported += 1;
      } catch (e) {
        failed += 1;
        console.warn("Contribution import row failed", row.line, e);
      }
      setProgress({ done: i + 1, total: validRows.length });
    }

    setResult({ imported, skipped: skippedRows.length, failed });
    setImporting(false);
    if (imported > 0) {
      toast.success(`Imported ${imported} contribution${imported === 1 ? "" : "s"}.`);
      qc.invalidateQueries({ queryKey: ["contribs"] });
    }
    if (failed > 0) toast.error(`${failed} row(s) failed to import.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            downloadCsv("contributions-import-template.csv", contributionTemplateCsv());
            toast.success("Template downloaded.");
          }}
        >
          <Download className="mr-2 h-4 w-4" /> Download Template
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
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
          ref={fileInputRef}
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
        Columns: <span className="font-mono">{CONTRIBUTION_COLUMNS.join(", ")}</span>. Rows must
        match an approved member by phone number; duplicate M-Pesa references are skipped.
      </p>

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className="bg-success text-success-foreground">{validRows.length} valid</Badge>
            <Badge className="bg-destructive/10 text-destructive">
              {skippedRows.length} skipped
            </Badge>
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
                  <TableHead>Member</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell className="text-xs text-muted-foreground">{row.line}</TableCell>
                    <TableCell className="text-sm">
                      {row.member_name || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">{row.member_phone}</TableCell>
                    <TableCell className="text-right text-sm">
                      {row.amount || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">{row.mpesa_ref}</TableCell>
                    <TableCell className="text-xs">{row.date}</TableCell>
                    <TableCell className="text-xs capitalize">{row.method}</TableCell>
                    <TableCell>
                      {row.errors.length > 0 ? (
                        <Badge className="bg-destructive/10 text-destructive">
                          {row.errors[0]}
                        </Badge>
                      ) : row.duplicate ? (
                        <Badge className="bg-gold/20 text-gold">Duplicate ref — skipped</Badge>
                      ) : (
                        <Badge className="bg-success text-success-foreground">Ready</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {result && (
            <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/5 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span>
                Imported {result.imported} · skipped {result.skipped} · failed {result.failed}
              </span>
            </div>
          )}

          <Button
            type="button"
            onClick={handleImport}
            disabled={importing || validRows.length === 0}
          >
            <Upload className="mr-2 h-4 w-4" />
            {importing
              ? `Importing ${progress.done}/${progress.total}…`
              : `Import ${validRows.length} Row${validRows.length === 1 ? "" : "s"}`}
          </Button>
        </>
      )}
    </div>
  );
}
