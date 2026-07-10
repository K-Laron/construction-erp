"use client";

import { useEffect, useState } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const saved = localStorage.getItem("theme");
      const theme = saved || (mq.matches ? "dark" : "light");
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(theme);
    };

    apply();
    mq.addEventListener("change", apply);
    window.addEventListener("themechange", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("themechange", apply);
    };
  }, []);

  if (!mounted) {
    return <>{children}</>;
  }

  return <>{children}</>;
}
