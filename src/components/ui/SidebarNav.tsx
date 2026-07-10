"use client";

import { useState } from "react";
import {
  ShoppingCart,
  Package,
  Users,
  Truck,
  BarChart3,
  Settings,
  Warehouse,
  Lock,
} from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { lockStoreAction } from "@/app/actions/store";

interface SidebarNavProps {
  activeView: string;
  onNavigate: (view: string) => void;
}

const navItems = [
  { id: "pos", label: "Point of Sale", icon: ShoppingCart },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "customers", label: "Customers", icon: Users },
  { id: "deliveries", label: "Deliveries", icon: Truck },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "maintenance", label: "Maintenance", icon: Settings },
] as const;

export default function SidebarNav({ activeView, onNavigate }: SidebarNavProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <nav
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={twMerge(
        clsx(
          "no-print relative flex flex-col h-full",
          "glass-panel rounded-none border-t-0 border-b-0 border-l-0",
          "transition-all duration-300 ease-in-out z-40",
          expanded ? "w-[220px]" : "w-16"
        )
      )}
    >
      {/* ── Brand ────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-surface-800 shrink-0 overflow-hidden">
        <Warehouse className="w-7 h-7 text-accent-500 shrink-0" />
        <span
          className={clsx(
            "font-bold text-lg text-interactive-600 tracking-tight whitespace-nowrap",
            "transition-all duration-300",
            expanded
              ? "opacity-100 translate-x-0"
              : "opacity-0 -translate-x-2 pointer-events-none"
          )}
        >
          CS-ERP
        </span>
      </div>

      {/* ── Nav items ────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-1 py-3 px-2 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={!expanded ? item.label : undefined}
              className={twMerge(
                clsx(
                  "group relative flex items-center gap-3 w-full rounded-lg",
                  "h-11 px-3 text-sm font-semibold",
                  "transition-all duration-200 ease-out cursor-pointer",
                  "focus-ring",
                  isActive
                    ? "bg-surface-800 text-interactive-600"
                    : "text-interactive-400 hover:text-interactive-600 hover:bg-surface-800"
                )
              )}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-accent-500" />
              )}

              <Icon
                className={clsx(
                  "w-5 h-5 shrink-0 transition-colors duration-200",
                  isActive ? "text-accent-500" : "text-interactive-400 group-hover:text-interactive-600"
                )}
              />

              <span
                className={clsx(
                  "whitespace-nowrap transition-all duration-300",
                  expanded
                    ? "opacity-100 translate-x-0"
                    : "opacity-0 -translate-x-2 pointer-events-none w-0"
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Lock store button ────────────────────────── */}
      <div className="shrink-0 border-t border-surface-800 p-2">
        <button
          onClick={async () => {
            await lockStoreAction();
            window.location.reload();
          }}
          title={!expanded ? "Lock Store" : undefined}
          className={twMerge(
            clsx(
              "flex items-center gap-3 w-full rounded-lg",
              "h-11 px-3 text-sm font-semibold",
              "text-interactive-400 hover:text-error-500 hover:bg-error-500/10",
              "transition-all duration-200 ease-out cursor-pointer",
              "focus-ring"
            )
          )}
        >
          <Lock className="w-5 h-5 shrink-0" />
          <span
            className={clsx(
              "whitespace-nowrap transition-all duration-300",
              expanded
                ? "opacity-100 translate-x-0"
                : "opacity-0 -translate-x-2 pointer-events-none w-0"
            )}
          >
            Lock Store
          </span>
        </button>
      </div>
    </nav>
  );
}
