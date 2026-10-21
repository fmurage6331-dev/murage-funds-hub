import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Check,
  ChevronsUpDown,
  HandCoins,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRoles } from "@/hooks/use-roles";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { donorLifetimeTotal } from "@/lib/donor-finances";
import { DONATION_CATEGORY } from "@/lib/transaction-categories";
import { UnauthorizedCard } from "@/components/shared/UnauthorizedCard";

export const Route = createFileRoute("/_authenticated/donors")({
  component: DonorsPage,
});

type DonorForm = { name: string; email: string; phone: string; address: string; notes: string };
type DonationForm = {
  donorId: string;
  amount: string;
  occurredOn: string;
  reference: string;
  description: string;
};
type DonorWithTotal = Tables<"donors"> & { total: number };
type DonorTransaction = Pick<Tables<"transactions">, "type" | "donor_id" | "amount">;
type DonorDonation = Pick<
  Tables<"transactions">,
  "id" | "amount" | "occurred_on" | "reference" | "description" | "category" | "created_at"
>;

const emptyDonorForm: DonorForm = { name: "", email: "", phone: "", address: "", notes: "" };

const fmt = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function todayLocal(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyDonationForm(): DonationForm {
  return { donorId: "", amount: "", occurredOn: todayLocal(), reference: "", description: "" };
}

function donationErrorMessage(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error ? String(error.message) : "";

  if (/permission|row.level security|violates.*policy|42501/i.test(message)) {
    return "This donation could not be saved because your account may not have permission to record transactions. Please ask an administrator to check your access.";
  }

  return "We couldn't save this donation. Please check the details and try again.";
}

function DonorsPage() {
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();
  const roles = useRoles(user.id);
  const canViewDonors = roles.isSecretariat || roles.isTreasurer;
  const canManageDonors = roles.isSecretariat;
  const canRecordDonations = roles.isAdmin || roles.isTreasurer;

  const {
    data: donors = [],
    isLoading: isLoadingDonors,
    isError: donorsError,
  } = useQuery<DonorWithTotal[]>({
    queryKey: ["donors", "with-totals"],
    enabled: canViewDonors,
    queryFn: async () => {
      const { data: donorRows, error: donorError } = await supabase
        .from("donors")
        .select("*")
        .order("name");
      if (donorError) throw donorError;

      const { data: transactions, error: transactionsError } = await supabase
        .from("transactions")
        .select("type, donor_id, amount");
      if (transactionsError) throw transactionsError;

      const donorTransactions = (transactions ?? []) as DonorTransaction[];
      // The list is for lifetime giving, so donors with no gifts remain visible at KES 0.
      return (donorRows ?? []).map((donor) => ({
        ...donor,
        total: donorLifetimeTotal(donorTransactions, donor.id),
      }));
    },
  });

  const [donorDialogOpen, setDonorDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [donorForm, setDonorForm] = useState<DonorForm>(emptyDonorForm);

  const [donationDialogOpen, setDonationDialogOpen] = useState(false);
  const [donorPickerOpen, setDonorPickerOpen] = useState(false);
  const [donationForm, setDonationForm] = useState<DonationForm>(emptyDonationForm);

  const [selectedDonorId, setSelectedDonorId] = useState<string | null>(null);
  const selectedDonor = donors.find((donor) => donor.id === selectedDonorId);

  const {
    data: donations = [],
    isLoading: isLoadingDonations,
    isError: donationsError,
  } = useQuery<DonorDonation[]>({
    queryKey: ["donor-donations", selectedDonorId],
    enabled: selectedDonorId !== null,
    queryFn: async () => {
      if (!selectedDonorId) return [];
      const { data, error } = await supabase
        .from("transactions")
        .select("id, amount, occurred_on, reference, description, category, created_at")
        .eq("donor_id", selectedDonorId)
        .eq("type", "income")
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const closeDonorDialog = () => {
    setDonorDialogOpen(false);
    setEditingId(null);
    setDonorForm(emptyDonorForm);
  };

  const startEdit = (donor: DonorWithTotal) => {
    setEditingId(donor.id);
    setDonorForm({
      name: donor.name,
      email: donor.email ?? "",
      phone: donor.phone ?? "",
      address: donor.address ?? "",
      notes: donor.notes ?? "",
    });
    setDonorDialogOpen(true);
  };

  const saveDonor = useMutation({
    mutationFn: async () => {
      if (!donorForm.name.trim()) throw new Error("Donor name is required.");

      const payload = {
        name: donorForm.name.trim(),
        email: donorForm.email.trim() || null,
        phone: donorForm.phone.trim() || null,
        address: donorForm.address.trim() || null,
        notes: donorForm.notes.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase.from("donors").update(payload).eq("id", editingId);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("donors").insert({ ...payload, created_by: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editingId ? "Donor updated" : "Donor added");
      closeDonorDialog();
      void queryClient.invalidateQueries({ queryKey: ["donors"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteDonor = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("donors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Donor deleted");
      void queryClient.invalidateQueries({ queryKey: ["donors"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const recordDonation = useMutation({
    mutationFn: async () => {
      const amount = Number(donationForm.amount);
      if (!donationForm.donorId) throw new Error("Choose a donor.");
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Enter an amount greater than zero.");
      }
      if (!donationForm.occurredOn) throw new Error("Choose the donation date.");

      const { error } = await supabase.from("transactions").insert({
        type: "income",
        category: DONATION_CATEGORY,
        amount,
        currency: "KES",
        occurred_on: donationForm.occurredOn,
        reference: donationForm.reference.trim() || null,
        description: donationForm.description.trim() || null,
        donor_id: donationForm.donorId,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Donor contribution recorded.");
      setDonationDialogOpen(false);
      setDonationForm(emptyDonationForm());
      setDonorPickerOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["donors"] });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["donor-donations"] });
    },
    onError: (error: unknown) => toast.error(donationErrorMessage(error)),
  });

  if (roles.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  if (!canViewDonors) {
    return (
      <UnauthorizedCard message="Donor records are available to the secretariat and treasurer." />
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-primary">Donors</h2>
          <p className="text-sm text-muted-foreground">
            People and organisations supporting the foundation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRecordDonations && (
            <Dialog
              open={donationDialogOpen}
              onOpenChange={(open) => {
                setDonationDialogOpen(open);
                if (!open) {
                  setDonationForm(emptyDonationForm());
                  setDonorPickerOpen(false);
                  recordDonation.reset();
                }
              }}
            >
              <Button
                type="button"
                disabled={donors.length === 0}
                onClick={() => {
                  setDonationForm(emptyDonationForm());
                  recordDonation.reset();
                  setDonationDialogOpen(true);
                }}
              >
                <HandCoins className="mr-2 h-4 w-4" /> Record donor contribution
              </Button>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle className="font-serif">Record donor contribution</DialogTitle>
                  <p className="text-sm text-muted-foreground">
                    Record donor income in the transaction ledger. Amounts are in KES.
                  </p>
                </DialogHeader>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    recordDonation.mutate();
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="donation-donor">Donor *</Label>
                    <Popover open={donorPickerOpen} onOpenChange={setDonorPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          id="donation-donor"
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={donorPickerOpen}
                          className="w-full justify-between font-normal"
                        >
                          <span className="truncate">
                            {donors.find((donor) => donor.id === donationForm.donorId)?.name ??
                              "Search and select a donor"}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-[var(--radix-popover-trigger-width)] p-0"
                      >
                        <Command>
                          <CommandInput placeholder="Search donors..." />
                          <CommandList>
                            <CommandEmpty>No donor found.</CommandEmpty>
                            <CommandGroup>
                              {donors.map((donor) => (
                                <CommandItem
                                  key={donor.id}
                                  value={`${donor.name} ${donor.email ?? ""} ${donor.phone ?? ""}`}
                                  onSelect={() => {
                                    setDonationForm({ ...donationForm, donorId: donor.id });
                                    setDonorPickerOpen(false);
                                  }}
                                >
                                  <Check
                                    className={`h-4 w-4 ${donationForm.donorId === donor.id ? "opacity-100" : "opacity-0"}`}
                                  />
                                  <span className="truncate">{donor.name}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="donation-amount">Amount (KES) *</Label>
                      <Input
                        id="donation-amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        required
                        value={donationForm.amount}
                        onChange={(event) =>
                          setDonationForm({ ...donationForm, amount: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="donation-date">Date *</Label>
                      <Input
                        id="donation-date"
                        type="date"
                        required
                        value={donationForm.occurredOn}
                        onChange={(event) =>
                          setDonationForm({ ...donationForm, occurredOn: event.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="donation-reference">Reference</Label>
                    <Input
                      id="donation-reference"
                      value={donationForm.reference}
                      onChange={(event) =>
                        setDonationForm({ ...donationForm, reference: event.target.value })
                      }
                      placeholder="Receipt number or payment reference"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="donation-description">Description</Label>
                    <Textarea
                      id="donation-description"
                      rows={3}
                      value={donationForm.description}
                      onChange={(event) =>
                        setDonationForm({ ...donationForm, description: event.target.value })
                      }
                      placeholder="Optional details about this contribution"
                    />
                  </div>

                  {recordDonation.isError && (
                    <div
                      role="alert"
                      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                    >
                      {donationErrorMessage(recordDonation.error)}
                    </div>
                  )}

                  <DialogFooter>
                    <Button type="submit" disabled={recordDonation.isPending}>
                      {recordDonation.isPending ? "Saving contribution…" : "Save contribution"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}

          {canManageDonors && (
            <Dialog
              open={donorDialogOpen}
              onOpenChange={(open) => (open ? setDonorDialogOpen(true) : closeDonorDialog())}
            >
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setDonorForm(emptyDonorForm);
                  setDonorDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Add Donor
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-serif">
                    {editingId ? "Edit donor" : "New donor"}
                  </DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveDonor.mutate();
                  }}
                  className="space-y-3"
                >
                  <div>
                    <Label htmlFor="donor-name">Name *</Label>
                    <Input
                      id="donor-name"
                      required
                      value={donorForm.name}
                      onChange={(event) => setDonorForm({ ...donorForm, name: event.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="donor-email">Email</Label>
                      <Input
                        id="donor-email"
                        type="email"
                        value={donorForm.email}
                        onChange={(event) =>
                          setDonorForm({ ...donorForm, email: event.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="donor-phone">Phone</Label>
                      <Input
                        id="donor-phone"
                        value={donorForm.phone}
                        onChange={(event) =>
                          setDonorForm({ ...donorForm, phone: event.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="donor-address">Address</Label>
                    <Input
                      id="donor-address"
                      value={donorForm.address}
                      onChange={(event) =>
                        setDonorForm({ ...donorForm, address: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="donor-notes">Notes</Label>
                    <Textarea
                      id="donor-notes"
                      rows={3}
                      value={donorForm.notes}
                      onChange={(event) =>
                        setDonorForm({ ...donorForm, notes: event.target.value })
                      }
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={saveDonor.isPending}>
                      {saveDonor.isPending ? "Saving…" : "Save donor"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {donorsError ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Donor records couldn't be loaded. Please refresh or contact an administrator.
          </CardContent>
        </Card>
      ) : isLoadingDonors ? (
        <p className="text-sm text-muted-foreground">Loading donors…</p>
      ) : donors.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No donors yet. Add a donor before recording a contribution.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {donors.map((donor) => (
            <Card key={donor.id} className="relative">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-serif text-lg font-semibold text-primary">
                      {donor.name}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-wider text-gold">
                      Lifetime giving: {fmt(donor.total)}
                    </div>
                  </div>
                  {canManageDonors && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${donor.name}`}
                        disabled={saveDonor.isPending || deleteDonor.isPending}
                        onClick={() => startEdit(donor)}
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      {roles.isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${donor.name}`}
                          disabled={deleteDonor.isPending}
                          onClick={() => {
                            if (confirm(`Delete ${donor.name}?`)) deleteDonor.mutate(donor.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                  {donor.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{donor.email}</span>
                    </div>
                  )}
                  {donor.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{donor.phone}</span>
                    </div>
                  )}
                  {donor.address && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{donor.address}</span>
                    </div>
                  )}
                  {donor.notes && <p className="pt-2 text-xs italic">{donor.notes}</p>}
                </div>

                <Button
                  type="button"
                  variant="link"
                  className="mt-3 h-auto px-0"
                  onClick={() => setSelectedDonorId(donor.id)}
                >
                  View donation history
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={selectedDonorId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDonorId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {selectedDonor?.name ?? "Donor"} — donation history
            </DialogTitle>
            {selectedDonor && (
              <p className="text-sm text-muted-foreground">
                Lifetime total:{" "}
                <span className="font-semibold text-foreground">{fmt(selectedDonor.total)}</span>
              </p>
            )}
          </DialogHeader>

          {donationsError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 p-4 text-sm text-destructive"
            >
              Donation history couldn't be loaded. Please close this window and try again.
            </div>
          ) : isLoadingDonations ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading donation history…
            </div>
          ) : donations.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No donations have been recorded for this donor yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {donations.map((donation) => (
                    <TableRow key={donation.id}>
                      <TableCell className="whitespace-nowrap">
                        {fmtDate(donation.occurred_on)}
                      </TableCell>
                      <TableCell className="max-w-40 truncate">
                        {donation.reference ?? "—"}
                      </TableCell>
                      <TableCell className="min-w-40">
                        <div>{donation.description ?? donation.category}</div>
                        {donation.description && (
                          <div className="text-xs text-muted-foreground">{donation.category}</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium text-success">
                        {fmt(Number(donation.amount))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!donationsError && !isLoadingDonations && donations.length > 0 && (
            <div className="flex justify-end border-t pt-3 text-sm font-semibold">
              Lifetime total: {fmt(selectedDonor?.total ?? 0)}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
