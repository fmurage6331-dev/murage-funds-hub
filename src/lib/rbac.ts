import type { Database } from "@/integrations/supabase/types";

export type Role = Database["public"]["Enums"]["app_role"];

/** Roles that grant any kind of officer (non-member) capability. */
export const OFFICER_ROLES: Role[] = [
  "admin",
  "treasurer",
  "chairman",
  "secretary",
  "assistant_secretary",
  "board_member",
];

/** Roles that may review contributions, transactions and financial statements. */
export const FINANCE_OFFICER_ROLES: Role[] = ["admin", "treasurer", "chairman"];

/** Roles that may manage meetings and donors. */
export const SECRETARIAT_ROLES: Role[] = ["admin", "secretary", "assistant_secretary"];

export type RoleFlags = {
  roles: Role[];
  isAdmin: boolean;
  isTreasurer: boolean;
  isChairman: boolean;
  isSecretary: boolean;
  isAssistantSecretary: boolean;
  isBoardMember: boolean;
  isMember: boolean;
  isOfficer: boolean;
  isFinanceOfficer: boolean;
  isSecretariat: boolean;
};

export function hasRole(roles: Role[], role: Role): boolean {
  return roles.includes(role);
}

export function hasAnyRole(roles: Role[], candidates: Role[]): boolean {
  return candidates.some((candidate) => roles.includes(candidate));
}

/** Derive every boolean the UI gates on from a member's role list. */
export function roleFlags(roles: Role[]): RoleFlags {
  return {
    roles,
    isAdmin: hasRole(roles, "admin"),
    isTreasurer: hasRole(roles, "treasurer"),
    isChairman: hasRole(roles, "chairman"),
    isSecretary: hasRole(roles, "secretary"),
    isAssistantSecretary: hasRole(roles, "assistant_secretary"),
    isBoardMember: hasRole(roles, "board_member"),
    isMember: hasRole(roles, "member"),
    isOfficer: hasAnyRole(roles, OFFICER_ROLES),
    isFinanceOfficer: hasAnyRole(roles, FINANCE_OFFICER_ROLES),
    isSecretariat: hasAnyRole(roles, SECRETARIAT_ROLES),
  };
}

export type NavIcon =
  | "dashboard"
  | "wallet"
  | "hand-coins"
  | "calendar-days"
  | "user"
  | "shield-check"
  | "receipt"
  | "landmark"
  | "file-spreadsheet"
  | "user-circle"
  | "scroll-text"
  | "users"
  | "gavel"
  | "settings"
  | "database";

export type NavItem = {
  title: string;
  url: string;
  icon: NavIcon;
  /** Small muted qualifier shown after the title (e.g. "view only"). */
  hint?: string;
};

export type NavSection = { label: string; items: NavItem[] };

/**
 * Sidebar structure for a given role set. Every role sees "My Account";
 * officers additionally get "Management" and admins "Administration".
 */
export function buildNavigation(roles: Role[]): NavSection[] {
  const r = roleFlags(roles);

  // A user with no officer role at all (or who also carries the member role)
  // still needs their own records.
  const seesOwnRecords = !r.isOfficer || r.isMember;

  const accountItems: NavItem[] = [{ title: "Dashboard", url: "/dashboard", icon: "dashboard" }];
  if (seesOwnRecords) {
    accountItems.push({ title: "My Contributions", url: "/my-contributions", icon: "wallet" });
    accountItems.push({ title: "My Loans", url: "/my-loans", icon: "hand-coins" });
  }
  accountItems.push({
    title: "Meetings",
    url: "/meetings",
    icon: "calendar-days",
    // Secretariat owns meetings; every other role may only read them.
    hint: r.isSecretariat ? undefined : "view only",
  });
  accountItems.push({ title: "My Account", url: "/my-account", icon: "user" });

  const managementItems: NavItem[] = [];
  if (r.isAdmin || r.isTreasurer) {
    managementItems.push({
      title: "Contributions Review",
      url: "/contributions-review",
      icon: "shield-check",
    });
    managementItems.push({ title: "Transactions", url: "/transactions", icon: "receipt" });
  }
  if (r.isFinanceOfficer) {
    managementItems.push({ title: "Loans Review", url: "/loans-review", icon: "landmark" });
    managementItems.push({
      title: "Financial Statements",
      url: "/financial-statements",
      icon: "file-spreadsheet",
    });
    managementItems.push({ title: "Member Profiles", url: "/member-profile", icon: "user-circle" });
    managementItems.push({ title: "Audit Logs", url: "/audit-logs", icon: "scroll-text" });
  }
  if (r.isSecretariat) {
    managementItems.push({ title: "Donors", url: "/donors", icon: "users" });
  }
  if (r.isAdmin || r.isBoardMember || r.isChairman) {
    managementItems.push({ title: "Loan Votes", url: "/loan-votes", icon: "gavel" });
  }

  const adminItems: NavItem[] = [];
  if (r.isAdmin) {
    adminItems.push({ title: "Users & Roles", url: "/users", icon: "users" });
    adminItems.push({ title: "Loan Rules", url: "/loan-rules", icon: "settings" });
    adminItems.push({ title: "Data Import", url: "/data-import", icon: "database" });
  }

  return [
    { label: "My Account", items: accountItems },
    ...(managementItems.length > 0 ? [{ label: "Management", items: managementItems }] : []),
    ...(adminItems.length > 0 ? [{ label: "Administration", items: adminItems }] : []),
  ];
}
