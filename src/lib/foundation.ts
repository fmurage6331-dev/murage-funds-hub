export const foundation = {
  name: "Murage Foundation",
  adminPhone: "+254182528510",
  webUrl: "https://murage-funds-hub.vercel.app",
  registrationStatus: "Not yet formally registered (CBO registration in progress)",
} as const;

export const payment = {
  bank: "KCB Bank Kenya",
  method: "M-Pesa Paybill",
  paybill: "522522",
  account: "798164",
} as const;

export const formatKES = (amount: number): string =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 }).format(amount);

export const formatKenyanDate = (date: string): string =>
  new Date(date.length === 10 ? `${date}T12:00:00+03:00` : date).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  });
