import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, UserCircle } from "lucide-react";
import { useRoles } from "@/hooks/use-roles";
import { UnauthorizedCard } from "@/components/shared/UnauthorizedCard";

export const Route = createFileRoute("/_authenticated/member-profile/")({
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  const r = useRoles(user.id);
  const [search, setSearch] = useState("");

  const canView = r.isAdmin || r.isTreasurer || r.isChairman;

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["member-profile-directory"],
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone_number, email, status, phone_only_member")
        .eq("status", "approved")
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (r.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  if (!r.isAdmin && !r.isTreasurer && !r.isChairman) {
    return <UnauthorizedCard message="This page is restricted to officers." />;
  }

  const query = search.trim().toLowerCase();
  const filtered = query
    ? members.filter(
        (m) =>
          (m.full_name ?? "").toLowerCase().includes(query) ||
          (m.phone_number ?? "").toLowerCase().includes(query) ||
          (m.email ?? "").toLowerCase().includes(query),
      )
    : members;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h2 className="font-serif text-2xl font-semibold text-primary">Member Profiles</h2>
        <p className="text-sm text-muted-foreground">
          Contribution and loan history for every approved member, including phone-only members.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, phone or email…"
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No members found.</div>
          ) : (
            filtered.map((m) => (
              <Link
                key={m.id}
                to="/member-profile/$memberId"
                params={{ memberId: m.id }}
                className="flex items-center justify-between gap-4 p-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{m.full_name ?? "Unnamed member"}</span>
                    {(!m.email || m.phone_only_member) && (
                      <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                        Phone Only
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.phone_number ?? "No phone"}
                    {m.email ? ` · ${m.email}` : ""}
                  </div>
                </div>
                <UserCircle className="h-5 w-5 shrink-0 text-muted-foreground" />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
