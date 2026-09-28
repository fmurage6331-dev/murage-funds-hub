import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALL_STATEMENT_SECTIONS,
  buildMemberStatementHtml,
  openPrintWindow,
  PERIOD_OPTIONS,
  periodSelectionError,
  resolvePeriod,
  type PeriodKey,
  type StatementSections,
} from "@/lib/export-documents";
import { loadMemberStatementData } from "@/lib/financial-data";

type StatementFormat = "pdf";

const SECTION_OPTIONS: Array<{ key: keyof StatementSections; label: string }> = [
  { key: "contributions", label: "Contribution History" },
  { key: "loans", label: "Loan Summary" },
  { key: "repayments", label: "Repayment Schedule" },
  { key: "balance", label: "Account Balance" },
];

type MemberStatementDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string | null;
  memberName?: string | null;
  /** Printed in the document header, e.g. "Treasurer". */
  generatedBy?: string;
};

/**
 * Period / format / section picker that renders a member financial statement
 * with the browser's own print pipeline (PDF) or a CSV download (Excel).
 * No external PDF or spreadsheet packages are involved.
 */
export function MemberStatementDialog({
  open,
  onOpenChange,
  memberId,
  memberName,
  generatedBy,
}: MemberStatementDialogProps) {
  const [periodKey, setPeriodKey] = useState<PeriodKey>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [format, setFormat] = useState<StatementFormat>("pdf");
  const [sections, setSections] = useState<StatementSections>(ALL_STATEMENT_SECTIONS);

  // Start from a clean form each time a different member is opened.
  useEffect(() => {
    if (!open) return;
    setPeriodKey("all");
    setCustomFrom("");
    setCustomTo("");
    setFormat("pdf");
    setSections(ALL_STATEMENT_SECTIONS);
  }, [open, memberId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["member-statement", memberId],
    enabled: open && Boolean(memberId),
    queryFn: () => loadMemberStatementData(memberId as string),
    staleTime: 0,
  });

  const toggleSection = (key: keyof StatementSections, checked: boolean) =>
    setSections((current) => ({ ...current, [key]: checked }));

  const handleGenerate = () => {
    if (!memberId) return;
    if (!data) {
      toast.error("Member records are still loading — try again in a moment.");
      return;
    }

    const selection = { key: periodKey, from: customFrom, to: customTo };
    const periodError = periodSelectionError(selection);
    if (periodError) {
      toast.error(periodError);
      return;
    }

    const hasSections = SECTION_OPTIONS.some((option) => sections[option.key]);
    if (!hasSections) {
      toast.error("Select at least one section to include in the statement.");
      return;
    }

    const options = {
      period: resolvePeriod(selection),
      sections,
      generatedBy: generatedBy ?? "Treasurer",
    };
    const memberLabel = data.profile?.full_name ?? memberName ?? "Member";

    if (format === "pdf") {
      const opened = openPrintWindow(
        `Murage Foundation - Member Statement - ${memberLabel}`,
        buildMemberStatementHtml(data, options),
        "portrait",
      );
      if (!opened) {
        toast.error("Allow pop-ups for this site to open the printable statement.");
        return;
      }
      toast.success("Statement opened — print or save it as PDF.");
      return;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Generate Member Statement</DialogTitle>
          <DialogDescription>
            {memberName
              ? `Contribution and loan statement for ${memberName}.`
              : "Contribution and loan statement for this member."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="statement-period">Period</Label>
            <Select value={periodKey} onValueChange={(value) => setPeriodKey(value as PeriodKey)}>
              <SelectTrigger id="statement-period">
                <SelectValue placeholder="Select a period" />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {periodKey === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="statement-from">From</Label>
                <Input
                  id="statement-from"
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="statement-to">To</Label>
                <Input
                  id="statement-to"
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="statement-format">Format</Label>
            <Select value={format} onValueChange={(value) => setFormat(value as StatementFormat)}>
              <SelectTrigger id="statement-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF Statement</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Include sections</legend>
            {SECTION_OPTIONS.map((option) => (
              <div key={option.key} className="flex items-center gap-2">
                <Checkbox
                  id={`statement-section-${option.key}`}
                  checked={sections[option.key]}
                  onCheckedChange={(checked) => toggleSection(option.key, checked === true)}
                />
                <Label
                  htmlFor={`statement-section-${option.key}`}
                  className="cursor-pointer text-sm"
                >
                  {option.label}
                </Label>
              </div>
            ))}
          </fieldset>

          {isLoading && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading member records…
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              Could not load member records: {(error as Error).message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={isLoading || !data} className="gap-2">
            <FileText className="h-4 w-4" />
            Generate PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
