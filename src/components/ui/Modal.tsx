"use client";

import { useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizeClasses: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      className={twMerge(
        clsx(
          "fixed inset-0 z-50",
          "flex items-center justify-center",
          "bg-black/60 backdrop-blur-sm",
          "animate-fade-in"
        )
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        className={twMerge(
          clsx(
            "relative w-full mx-4",
            sizeClasses[size],
            "glass-panel",
            "shadow-2xl shadow-black/40",
            "animate-slide-up"
          )
        )}
      >
        {/* ── Header ────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <h2 className="text-lg font-semibold text-slate-100 tracking-tight">
            {title}
          </h2>
          <button
            onClick={onClose}
            className={twMerge(
              clsx(
                "flex items-center justify-center w-8 h-8 rounded-lg",
                "text-slate-400 hover:text-slate-100",
                "hover:bg-slate-700/60",
                "transition-colors duration-150",
                "focus-ring cursor-pointer"
              )
            )}
            aria-label="Close modal"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* ── Body ──────────────────────────────────── */}
        <div className="px-6 py-5 max-h-[calc(100vh-12rem)] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
