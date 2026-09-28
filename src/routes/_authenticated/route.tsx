import { toast } from "sonner";
import { useEffect } from "react";
import { fetchProfileStatus, profileStatusOptions } from "@/lib/profile-status";
import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Receipt,
  Users,
  LogOut,
  Leaf,
  HandCoins,
  Landmark,
  CalendarDays,
  ShieldCheck,
  Settings,
  Wallet,
  Gavel,
  ScrollText,
  FileSpreadsheet,
  User,
  UserCircle,
  Database,
} from "lucide-react";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });

    const profile = await fetchProfileStatus(data.user.id);

    if (profile?.status !== "approved") throw redirect({ to: "/pending-approval" });

    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const r = useRoles(user.id);
  const { data: profile, error: statusError } = useQuery(profileStatusOptions(user.id));
  useEffect(() => {
    if (profile && profile.status !== "approved") {
      void navigate({ to: "/pending-approval", replace: true });
    }
  }, [profile, navigate]);

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      await qc.cancelQueries();
      qc.clear();
      await navigate({ to: "/auth", replace: true });
    } catch {
      toast.error("Unable to sign out. Please retry.");
    }
  };

  type Item = {
    title: string;
    url: string;
    icon: typeof LayoutDashboard;
    /** Small muted qualifier shown after the title (e.g. "view only"). */
    hint?: string;
  };
  type Section = { label: string; items: Item[] };

  // A user with no officer role at all (or who also carries the member role)
  // still needs their own records.
  const seesOwnRecords = !r.isOfficer || r.isMember;

  // ── "My Account" — visible to every role ──────────────────────────────
  const accountItems: Item[] = [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }];
  if (seesOwnRecords) {
    accountItems.push({ title: "My Contributions", url: "/my-contributions", icon: Wallet });
    accountItems.push({ title: "My Loans", url: "/my-loans", icon: HandCoins });
  }
  accountItems.push({
    title: "Meetings",
    url: "/meetings",
    icon: CalendarDays,
    // Secretariat owns meetings; everyone else may only read them.
    hint: r.isSecretariat ? undefined : "view only",
  });
  accountItems.push({ title: "My Account", url: "/my-account", icon: User });

  // ── "Management" — officer roles ──────────────────────────────────────
  const managementItems: Item[] = [];
  if (r.isAdmin || r.isTreasurer) {
    managementItems.push({
      title: "Contributions Review",
      url: "/contributions-review",
      icon: ShieldCheck,
    });
    managementItems.push({ title: "Transactions", url: "/transactions", icon: Receipt });
  }
  if (r.isFinanceOfficer) {
    managementItems.push({ title: "Loans Review", url: "/loans-review", icon: Landmark });
    managementItems.push({
      title: "Financial Statements",
      url: "/financial-statements",
      icon: FileSpreadsheet,
    });
    managementItems.push({ title: "Member Profiles", url: "/member-profile", icon: UserCircle });
    managementItems.push({ title: "Audit Logs", url: "/audit-logs", icon: ScrollText });
  }
  if (r.isSecretariat) {
    managementItems.push({ title: "Donors", url: "/donors", icon: Users });
  }
  if (r.isAdmin || r.isBoardMember || r.isChairman) {
    managementItems.push({ title: "Loan Votes", url: "/loan-votes", icon: Gavel });
  }

  // ── "Administration" — admin only ─────────────────────────────────────
  const adminItems: Item[] = [];
  if (r.isAdmin) {
    adminItems.push({ title: "Users & Roles", url: "/users", icon: Users });
    adminItems.push({ title: "Loan Rules", url: "/loan-rules", icon: Settings });
    adminItems.push({ title: "Data Import", url: "/data-import", icon: Database });
  }

  const sections: Section[] = [
    { label: "My Account", items: accountItems },
    ...(managementItems.length > 0 ? [{ label: "Management", items: managementItems }] : []),
    ...(adminItems.length > 0 ? [{ label: "Administration", items: adminItems }] : []),
  ];

  const allItems = sections.flatMap((section) => section.items);
  const isActiveItem = (url: string) => path === url || path.startsWith(`${url}/`);
  const activeTitle = allItems.find((i) => isActiveItem(i.url))?.title ?? "Overview";

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <Sidebar collapsible="icon">
          <SidebarHeader className="border-b border-sidebar-border">
            <div className="flex items-center gap-2 px-2 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gold text-gold-foreground">
                <Leaf className="h-4 w-4" />
              </div>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                <div className="truncate font-serif text-sm font-semibold text-sidebar-foreground">
                  Murage Foundation
                </div>
                <div className="truncate text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
                  Financial Records
                </div>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent>
            {sections.map((section) => (
              <SidebarGroup key={section.label}>
                <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={isActiveItem(item.url)}>
                          <Link to={item.url} className="flex items-center gap-2">
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                            {item.hint && (
                              <span className="ml-auto text-[10px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
                                {item.hint}
                              </span>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>

          <SidebarFooter className="border-t border-sidebar-border">
            <div className="px-2 py-2 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-xs text-sidebar-foreground/80">{user.email}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gold">
                {r.roles.length ? r.roles.join(" · ").replace(/_/g, " ") : "Member"}
              </div>
            </div>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={signOut}>
                  <LogOut className="h-4 w-4" />
                  <span>Sign out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <div className="font-serif text-lg font-semibold text-primary">{activeTitle}</div>
            </div>
          </header>
          <main className="flex-1 bg-background p-6">
            {statusError ? (
              <p role="alert">Unable to verify membership. Please retry.</p>
            ) : profile?.status === "approved" ? (
              <Outlet />
            ) : (
              <p>Checking membership…</p>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
