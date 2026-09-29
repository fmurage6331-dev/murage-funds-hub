"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstallBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isClient, setIsClient] = useState(false);

  const DISMISSED_KEY = "pwa-install-dismissed";

  useEffect(() => {
    setIsClient(true);

    const dismissed = sessionStorage.getItem(DISMISSED_KEY);
    if (dismissed) return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const event = e as BeforeInstallPromptEvent;
      setDeferredPrompt(event);
      setShowBanner(true);
    };

    const handleAppInstalled = () => {
      setShowBanner(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    // Listen for messages from service worker
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === "PWA_INSTALL_AVAILABLE" && !sessionStorage.getItem(DISMISSED_KEY)) {
        setShowBanner(true);
      }
      if (event.data?.type === "PWA_INSTALLED") {
        setShowBanner(false);
        setDeferredPrompt(null);
      }
    };

    navigator.serviceWorker?.addEventListener("message", handleSWMessage);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      navigator.serviceWorker?.removeEventListener("message", handleSWMessage);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === "accepted") {
        console.log("User accepted PWA install");
      }
    } catch (error) {
      console.warn("Install prompt failed:", error);
    } finally {
      setShowBanner(false);
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShowBanner(false);
    sessionStorage.setItem(DISMISSED_KEY, "true");
  }, []);

  if (!isClient || !showBanner) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
      role="dialog"
      aria-label="Install Murage Hub app"
      style={{ boxShadow: "0 -4px 20px rgba(0,0,0,0.15)" }}
    >
      <div className="bg-[#1a472a] text-white rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] p-4">
        <div className="flex items-start justify-between gap-4 max-w-screen-xl mx-auto">
          <div className="flex-1">
            <p className="text-sm font-medium">
              Install Murage Hub on your device for faster access.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleInstall}
              className="px-4 py-2 text-sm font-medium text-[#1a472a] bg-white rounded-lg hover:bg-gray-100 transition-colors"
            >
              Install App
            </button>
            <button
              onClick={handleDismiss}
              className="p-2 text-white/80 hover:text-white transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}