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
import { buildNavigation, type NavIcon } from "@/lib/rbac";

/** Sidebar icons keyed by the identifiers returned by `buildNavigation`. */
const NAV_ICONS = {
  dashboard: LayoutDashboard,
  wallet: Wallet,
  "hand-coins": HandCoins,
  "calendar-days": CalendarDays,
  user: User,
  "shield-check": ShieldCheck,
  receipt: Receipt,
  landmark: Landmark,
  "file-spreadsheet": FileSpreadsheet,
  "user-circle": UserCircle,
  "scroll-text": ScrollText,
  users: Users,
  gavel: Gavel,
  settings: Settings,
  database: Database,
} satisfies Record<NavIcon, typeof LayoutDashboard>;

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

  const sections = buildNavigation(r.roles);
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
                    {section.items.map((item) => {
                      const Icon = NAV_ICONS[item.icon];
                      return (
                        <SidebarMenuItem key={item.url}>
                          <SidebarMenuButton asChild isActive={isActiveItem(item.url)}>
                            <Link to={item.url} className="flex items-center gap-2">
                              <Icon className="h-4 w-4" />
                              <span>{item.title}</span>
                              {item.hint && (
                                <span className="ml-auto text-[10px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
                                  {item.hint}
                                </span>
                              )}
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
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
