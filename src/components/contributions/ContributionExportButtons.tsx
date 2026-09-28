import { useCallback, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv-import";
import {
  buildContributionsCsv,
  contributionsFileName,
  type ContributionExportRow,
} from "@/lib/export-documents";
import { loadProfileNames } from "@/lib/financial-data";
import { embeddedProfile } from "@/lib/member-profiles";

/** The `contributions` columns the export needs, plus an optional embed. */
export type ExportableContributionRow = {
  amount: number;
  contributed_on: string;
  method: string;
  reference: string | null;
  mpesa_transaction_id: string | null;
  status: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  on_behalf_of: boolean | null;
  notes: string | null;
  member_id: string;
  profiles?: unknown;
};

type ContributionExportButtonsProps = {
  /** Exactly the rows the treasurer can currently see (status filter applied). */
  rows: ExportableContributionRow[];
  /** Description of the active status filter, printed on the documents. */
  scopeLabel: string;
  generatedBy?: string;
};

/**
 * Treasurer/admin exports for the contributions review queue.
 *
 * "Export Excel" writes a CSV (Blob + object URL) that Excel opens natively and
 * "Export PDF" hands a formatted HTML document to the browser's print pipeline —
 * neither path uses a third-party spreadsheet or PDF package.
 */
export function ContributionExportButtons({
  rows,
  scopeLabel,
  generatedBy = "Treasurer",
}: ContributionExportButtonsProps) {
  const [exporting, setExporting] = useState<"excel" | null>(null);

  const buildExportRows = useCallback(async (): Promise<ContributionExportRow[]> => {
    const confirmerIds = rows
      .map((row) => row.confirmed_by)
      .filter((id): id is string => Boolean(id));

    // `contributions.confirmed_by` points at auth.users, so there is no embed
    // to rely on — resolve the officer names with a second query. A failure
    // here must not block the export, the column simply stays blank.
    const confirmerNames = await loadProfileNames(confirmerIds).catch((error: unknown) => {
      console.warn("[contribution-export] could not resolve confirmer names", error);
      return new Map<string, string>();
    });

    return rows.map((row) => {
      const profile = embeddedProfile(row.profiles);
      return {
        memberName: profile?.full_name ?? "Unknown member",
        phone: profile?.phone_number ?? "",
        email: profile?.email ?? "",
        amount: Number(row.amount),
        date: row.contributed_on,
        method: row.method,
        reference: row.reference ?? row.mpesa_transaction_id ?? "",
        status: row.status,
        confirmedBy: row.confirmed_by ? (confirmerNames.get(row.confirmed_by) ?? "") : "",
        confirmedAt: row.confirmed_at,
        officerEntry: row.on_behalf_of === true,
        notes: row.notes ?? "",
      };
    });
  }, [rows]);

  const handleExportExcel = async () => {
    if (rows.length === 0) {
      toast.error("There is nothing to export for this filter.");
      return;
    }
    setExporting("excel");
    try {
      const exportRows = await buildExportRows();
      downloadCsv(
        contributionsFileName(),
        buildContributionsCsv(exportRows, { scopeLabel, generatedBy }),
      );
      toast.success("Contributions exported — the CSV opens in Excel.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export contributions.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => void handleExportExcel()}
        disabled={exporting !== null}
        className="gap-2 border-green-600 text-green-700 hover:bg-green-50 hover:text-green-800"
      >
        <FileSpreadsheet className="h-4 w-4" />
        {exporting === "excel" ? "Exporting…" : "Export Excel"}
      </Button>
    </>
  );
}
