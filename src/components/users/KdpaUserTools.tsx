import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Download, Trash2, MoreVertical } from "lucide-react";
import { toast } from "sonner";

interface KdpaUserToolsProps {
  userProfile: {
    id: string;
    full_name: string | null;
    email: string | null;
    status: string;
    created_at: string;
    consent_given?: boolean;
    consent_timestamp?: string | null;
    consent_version?: string | null;
    data_retention_until?: string | null;
    is_anonymized?: boolean;
  };
}

export function KdpaUserTools({ userProfile }: KdpaUserToolsProps) {
  const qc = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // KDPA Data Portability Export (Section 38)
  const exportUserData = async () => {
    setIsExporting(true);
    try {
      const [contribsRes, loansRes, auditRes, rolesRes] = await Promise.all([
        supabase.from("contributions").select("*").eq("member_id", userProfile.id),
        supabase.from("loans").select("*, loan_repayments(*)").eq("member_id", userProfile.id),
        supabase.from("audit_logs").select("*").eq("performed_by", userProfile.id),
        supabase.from("user_roles").select("*").eq("user_id", userProfile.id),
      ]);

      const archive = {
        compliance:
          "Kenya Data Protection Act (KDPA) 2019 - Data Subject Access & Portability Request",
        export_date: new Date().toISOString(),
        data_controller: "Murage Foundation",
        data_subject: {
          id: userProfile.id,
          full_name: userProfile.full_name,
          email: userProfile.email,
          status: userProfile.status,
          account_created_at: userProfile.created_at,
          kdpa_consent_given: userProfile.consent_given ?? false,
          kdpa_consent_timestamp: userProfile.consent_timestamp,
          kdpa_consent_version: userProfile.consent_version,
          statutory_data_retention_until: userProfile.data_retention_until,
          is_anonymized: userProfile.is_anonymized ?? false,
        },
        roles: rolesRes.data ?? [],
        contributions: contribsRes.data ?? [],
        loans_and_repayments: loansRes.data ?? [],
        audit_trail_activities: auditRes.data ?? [],
      };

      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `KDPA_Data_Archive_${(userProfile.full_name || "member").replace(/\s+/g, "_")}_${userProfile.id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("KDPA Data Subject archive exported successfully");
    } catch (err: unknown) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsExporting(false);
    }
  };

  // KDPA Right to Erasure / Anonymization (Section 40)
  const eraseUserData = useMutation({
    mutationFn: async () => {
      // Check if user has financial records
      const [cRes, lRes] = await Promise.all([
        supabase.from("contributions").select("id").eq("member_id", userProfile.id),
        supabase.from("loans").select("id").eq("member_id", userProfile.id),
      ]);

      const hasFinancialRecords = (cRes.data?.length ?? 0) > 0 || (lRes.data?.length ?? 0) > 0;

      if (!hasFinancialRecords) {
        // Can safely hard delete profile and roles
        await supabase.from("user_roles").delete().eq("user_id", userProfile.id);
        const { error } = await supabase.from("profiles").delete().eq("id", userProfile.id);
        if (error) throw error;
      } else {
        // Must anonymize to preserve statutory financial audit trail
        const shortId = userProfile.id.slice(0, 8);
        const { error: profErr } = await supabase
          .from("profiles")
          .update({
            full_name: `Anonymized Member (${shortId})`,
            email: `anonymized_${shortId}@kdpa.murage.internal`,
            status: "rejected",
            is_anonymized: true,
            anonymized_at: new Date().toISOString(),
          })
          .eq("id", userProfile.id);
        if (profErr) throw profErr;

        // Remove active roles
        await supabase.from("user_roles").delete().eq("user_id", userProfile.id);

        // Redact personal notes in contributions and loans
        await supabase
          .from("contributions")
          .update({ notes: "[REDACTED UNDER KDPA SECTION 40]", reference: "[REDACTED]" })
          .eq("member_id", userProfile.id);

        await supabase
          .from("loans")
          .update({ purpose: "[REDACTED UNDER KDPA SECTION 40]" })
          .eq("member_id", userProfile.id);
      }
    },
    onSuccess: () => {
      toast.success("Member personal data erased/anonymized in compliance with KDPA");
      setShowDeleteConfirm(false);
      qc.invalidateQueries({ queryKey: ["users-with-roles"] });
    },
    onError: (err: unknown) => {
      toast.error(`Erasure failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 text-xs">
          <DropdownMenuLabel className="flex items-center gap-1.5 text-muted-foreground font-normal">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> KDPA Compliance Tools
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={exportUserData}
            disabled={isExporting}
            className="cursor-pointer gap-2"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Subject Data (JSON)</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setShowDeleteConfirm(true)}
            className="cursor-pointer text-destructive focus:text-destructive gap-2"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Erase / Anonymize Personal Data</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive font-serif">
              <Trash2 className="h-5 w-5" />
              KDPA Right to Erasure Request
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-xs">
              <p>
                You are executing a Right to Erasure request under Section 40 of the Kenya Data
                Protection Act 2019 for:
              </p>
              <div className="rounded bg-muted p-2 font-mono text-[11px] text-foreground">
                {userProfile.full_name} ({userProfile.email})
              </div>
              <p>
                <strong>Statutory Retention Note:</strong> In compliance with Kenyan accounting and
                tax laws, historical financial transactions and loan balances cannot be destroyed.
                Instead, personal identifiers (name, email, notes) will be permanently redacted and
                anonymized.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={eraseUserData.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                eraseUserData.mutate();
              }}
              disabled={eraseUserData.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {eraseUserData.isPending ? "Erasing..." : "Confirm KDPA Erasure"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
