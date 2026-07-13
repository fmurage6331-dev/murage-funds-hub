import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
  SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Receipt, Users, LogOut, Leaf } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Transactions", url: "/transactions", icon: Receipt },
  { title: "Donors", url: "/donors", icon: Users },
] as const;

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const { data: role } = useQuery({
    queryKey: ["role", user.id],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      return data?.map((r) => r.role) ?? [];
    },
  });

  const isAdmin = role?.includes("admin");

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

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
              <SidebarGroupLabel>Manage</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.title}>
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
          </SidebarContent>

          <SidebarFooter className="border-t border-sidebar-border">
            <div className="px-2 py-2 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-xs text-sidebar-foreground/80">{user.email}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gold">
                {isAdmin ? "Administrator" : "Member"}
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
              <div className="font-serif text-lg font-semibold text-primary">
                {items.find((i) => i.url === path)?.title ?? "Overview"}
              </div>
            </div>
            {!isAdmin && (
              <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">Read only</span>
            )}
          </header>
          <main className="flex-1 bg-background p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
