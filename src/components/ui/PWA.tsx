'use client';
import { logger } from "@/lib/logger";
import { useEffect } from 'react';

export function PWA() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          logger.error('ServiceWorker registration failed: ', err);
        });
      });
    }
  }, []);
  return null;
}
