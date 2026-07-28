"use client";

import { useEffect } from "react";

// Registers the service worker ambiently on every dashboard page load --
// harmless with no active subscription, and required groundwork for both
// installability (the manifest's install prompt needs a registered SW) and
// Web Push (a subscription can't be created without one). Requesting
// notification permission itself stays a separate, explicit action on the
// Settings page -- registering the worker never prompts the user for
// anything.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  }, []);

  return null;
}
