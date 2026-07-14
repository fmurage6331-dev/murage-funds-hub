import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
  SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard, Receipt, Users, LogOut, Leaf, HandCoins, Landmark,
  CalendarDays, ShieldCheck, Settings, Wallet, Gavel,
} from "lucide-react";
import { useRoles } from "@/hooks/use-roles";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
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

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  type Item = { title: string; url: string; icon: typeof LayoutDashboard };

  const memberItems: Item[] = [
    { title: "My Contributions", url: "/my-contributions", icon: Wallet },
    { title: "My Loans", url: "/my-loans", icon: HandCoins },
    { title: "Meetings", url: "/meetings", icon: CalendarDays },
  ];

  const financeItems: Item[] = [];
  if (r.canViewFinancials) financeItems.push({ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard });
  if (r.canConfirmContribs) financeItems.push({ title: "Contributions Review", url: "/contributions-review", icon: ShieldCheck });
  if (r.canViewFinancials) financeItems.push({ title: "Transactions", url: "/transactions", icon: Receipt });
  if (r.canForwardLoans || r.isBoard || r.isAdmin) financeItems.push({ title: "Loan Requests", url: "/loans-review", icon: Landmark });
  if (r.isBoard || r.isAdmin) financeItems.push({ title: "Board Votes", url: "/loan-votes", icon: Gavel });
  if (r.isSecretary || r.isAdmin) financeItems.push({ title: "Donors", url: "/donors", icon: Users });

  const adminItems: Item[] = [];
  if (r.isAdmin) {
    adminItems.push({ title: "Users & Roles", url: "/users", icon: Users });
    adminItems.push({ title: "Loan Rules", url: "/loan-rules", icon: Settings });
  }

  const allItems = [...memberItems, ...financeItems, ...adminItems];
  const activeTitle = allItems.find((i) => i.url === path)?.title ?? "Overview";

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
                <div className="truncate font-serif text-sm font-semibold text-sidebar-foreground">Murage Foundation</div>
                <div className="truncate text-[10px] uppercase tracking-wider text-sidebar-foreground/60">Financial Records</div>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>My Account</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {memberItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={path === item.url}>
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {financeItems.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>Foundation</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {financeItems.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={path === item.url}>
                          <Link to={item.url} className="flex items-center gap-2">
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {adminItems.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>Admin</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {adminItems.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={path === item.url}>
                          <Link to={item.url} className="flex items-center gap-2">
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
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
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
