import type { Tables } from "@/integrations/supabase/types";

type DonorTransaction = Pick<Tables<"transactions">, "type" | "donor_id" | "amount">;

/** Sum income transactions attached to one donor; member contributions are not included. */
export function donorLifetimeTotal(
  transactions: readonly DonorTransaction[],
  donorId: string,
): number {
  return transactions.reduce((total, transaction) => {
    if (transaction.type !== "income" || transaction.donor_id !== donorId) return total;
    return total + Number(transaction.amount);
  }, 0);
}

/** Count distinct donors with at least one positive income transaction. */
export function countActiveDonors(transactions: readonly DonorTransaction[]): number {
  const donorIds = new Set<string>();

  transactions.forEach((transaction) => {
    if (transaction.type === "income" && transaction.donor_id && Number(transaction.amount) > 0) {
      donorIds.add(transaction.donor_id);
    }
  });

  return donorIds.size;
}
