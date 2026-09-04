import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Repeat,
  ScrollText,
  ReceiptText,
  BadgeCheck,
  Mail,
  Moon,
  Sun,
  ShoppingCart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/subscriptions", label: "Subscriptions", icon: ReceiptText },
  { to: "/events", label: "Raw Events", icon: ScrollText },
  { to: "/recovery", label: "Recovery", icon: Repeat },
  { to: "/checkouts", label: "Checkouts", icon: ShoppingCart },
  { to: "/deliveries", label: "Deliveries", icon: Mail },
  { to: "/audit", label: "Audit Ledger", icon: BadgeCheck },
];

export function AppSidebar() {
  const router = useRouterState();
  const { theme, toggleTheme } = useTheme();
  const pathname = router.location.pathname;

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-card md:flex">
      <div className="flex h-14 items-center border-b px-4 font-semibold text-lg">
        💳 Revenue Recovery
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive =
            item.to === "/"
              ? pathname === "/"
              : pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={toggleTheme}
        >
          {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          {theme === "light" ? "Dark mode" : "Light mode"}
        </Button>
      </div>
    </aside>
  );
}
