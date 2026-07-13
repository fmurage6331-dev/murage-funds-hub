import { createFileRoute, Link } from "@tanstack/react-router";
import { Leaf, ShieldCheck, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Leaf className="h-5 w-5" />
            </div>
            <div className="font-serif text-lg font-semibold tracking-tight">
              Murage Foundation
            </div>
          </div>
          <Link
            to="/auth"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-medium text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            Internal financial system
          </div>
          <h1 className="mt-6 font-serif text-5xl font-semibold leading-tight text-primary md:text-6xl">
            Stewarding every shilling with clarity and care.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            A private records system for the Murage Foundation team to track donors, income
            and expenses — with dashboards and reports that keep the mission accountable.
          </p>
          <div className="mt-8 flex gap-3">
            <Link
              to="/auth"
              className="rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in to continue
            </Link>
          </div>
        </div>

        <div className="mt-24 grid gap-6 md:grid-cols-3">
          {[
            { icon: TrendingUp, title: "Income & expenses", body: "Log every transaction with category, date and receipt reference." },
            { icon: Leaf, title: "Donor registry", body: "Keep a living record of donors and their contribution history." },
            { icon: ShieldCheck, title: "Role-based access", body: "Only admins can edit records. Members can view and audit." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-card p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-serif text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Murage Foundation. Confidential financial records.
        </div>
      </footer>
    </div>
  );
}
