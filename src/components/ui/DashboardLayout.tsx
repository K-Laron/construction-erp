"use client";

import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  ShoppingCart,
  Package,
  Users,
  Truck,
  BarChart3,
  Settings,
  CircleDot,
  UserCircle,
} from "lucide-react";
import SidebarNav from "./SidebarNav";
import { ThemeToggle } from "./ThemeToggle";

interface DashboardLayoutProps {
  children: React.ReactNode;
  activeView: string;
  onNavigate: (view: string) => void;
  currentUser: any;
  isUnlocked: boolean;
}

const viewMeta: Record<string, { title: string; icon: React.ElementType }> = {
  pos: { title: "Point of Sale", icon: ShoppingCart },
  inventory: { title: "Inventory Management", icon: Package },
  customers: { title: "Customer Accounts", icon: Users },
  deliveries: { title: "Delivery Tracking", icon: Truck },
  reports: { title: "Reports & Analytics", icon: BarChart3 },
  maintenance: { title: "System Maintenance", icon: Settings },
};

export default function DashboardLayout({
  children,
  activeView,
  onNavigate,
  currentUser,
  isUnlocked,
}: DashboardLayoutProps) {
  const meta = viewMeta[activeView] ?? { title: "Dashboard", icon: ShoppingCart };
  const ViewIcon = meta.icon;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent">
      <SidebarNav activeView={activeView} onNavigate={onNavigate} currentUser={currentUser} />

      <div className="flex flex-col flex-1 min-w-0">
        <header
          className={twMerge(
            clsx(
              "no-print flex items-center justify-between",
              "h-16 px-6 shrink-0 relative z-10",
              "glass-panel-dense rounded-none border-x-0 border-t-0 shadow-sm"
            )
          )}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-surface-800 rounded-lg">
              <ViewIcon className="w-5 h-5 text-interactive-500" />
            </div>
            <h1 className="text-lg font-bold text-interactive-600 tracking-tight">
              {meta.title}
            </h1>
          </div>

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-surface-950 border border-surface-800">
              <CircleDot
                className={clsx(
                  "w-4 h-4",
                  isUnlocked ? "text-accent-500 animate-pulse" : "text-error-500"
                )}
              />
              <span
                className={clsx(
                  "text-sm font-semibold tracking-wide",
                  isUnlocked ? "text-accent-500" : "text-error-500"
                )}
              >
                {isUnlocked ? "Shift Active" : "Store Locked"}
              </span>
            </div>

            <div className="w-px h-6 bg-surface-700" />

            <ThemeToggle />

            <div className="w-px h-6 bg-surface-700" />

            <div className="flex items-center gap-3 hover:bg-surface-800 p-1.5 pr-4 rounded-full transition-smooth cursor-pointer">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-interactive-600">
                <UserCircle className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-interactive-600 leading-tight">
                  {currentUser?.name ?? "Operator"}
                </span>
                <span className="text-[11px] text-interactive-400 font-medium leading-tight">
                  {currentUser?.role ?? "Cashier"}
                </span>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
