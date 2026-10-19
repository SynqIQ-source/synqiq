import {
  Bell,
  BookOpen,
  Calendar,
  ClipboardList,
  Flame,
  KeyRound,
  LayoutDashboard,
  MailCheck,
  MessageSquare,
  Repeat2,
  Settings,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

// Shared by the desktop sidebar and the mobile bottom nav so a page's icon
// can't drift between the two. Keyed by href; plain data, but only ever
// imported by client components (a component function can't be passed from
// a server component as a prop).
export const NAV_ICONS_BY_HREF: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/classes": BookOpen,
  "/dashboard/schedule": Calendar,
  "/dashboard/follow-up": MailCheck,
  "/dashboard/sub-requests": Repeat2,
  "/dashboard/messages": MessageSquare,
  "/dashboard/notifications": Bell,
  "/dashboard/heatmap": Flame,
  "/dashboard/instructors": Users,
  "/dashboard/trainer-health": TrendingUp,
  "/dashboard/substitutions": ClipboardList,
  "/dashboard/settings": Settings,
  "/dashboard/settings/imports": Upload,
  "/dashboard/settings/staff": KeyRound,
  "/dashboard/settings/eligibility": ShieldCheck,
  "/dashboard/comp-audit": ShieldAlert,
};
