"use client";

import { useEffect, useState } from "react";

type Status = "unsupported" | "checking" | "disabled" | "enabling" | "enabled" | "denied" | "error";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function NotificationsForm() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setStatus(subscription ? "enabled" : "disabled"))
      .catch(() => setStatus("disabled"));
  }, []);

  async function handleEnable() {
    setStatus("enabling");
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "disabled");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        throw new Error("Push is not configured (missing VAPID public key).");
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // TS's current DOM lib types Uint8Array as generic over
        // ArrayBufferLike while PushSubscriptionOptionsInit still wants one
        // backed by a concrete ArrayBuffer -- a real typing gap, not a
        // runtime concern, since Uint8Array.from always backs onto a plain
        // ArrayBuffer in every browser this code runs in.
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Failed to save subscription.");
      }

      setStatus("enabled");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleDisable() {
    setStatus("enabling");
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setStatus("disabled");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-zinc-950">Notifications on this device</h2>

      {status === "unsupported" && (
        <p className="text-sm text-zinc-500">This browser doesn&apos;t support push notifications.</p>
      )}
      {status === "checking" && <p className="text-sm text-zinc-500">Checking status...</p>}
      {status === "denied" && (
        <p className="text-sm text-zinc-500">
          Notifications are blocked for this site in your browser settings. Allow them there to enable this.
        </p>
      )}
      {status === "disabled" && (
        <>
          <p className="text-sm text-zinc-500">Get notified here about open sub requests and new messages.</p>
          <button
            onClick={handleEnable}
            className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Enable notifications
          </button>
        </>
      )}
      {status === "enabling" && <p className="text-sm text-zinc-500">Working...</p>}
      {status === "enabled" && (
        <>
          <p className="text-sm text-emerald-700">Notifications are enabled on this device.</p>
          <button
            onClick={handleDisable}
            className="w-fit rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Disable on this device
          </button>
        </>
      )}
      {status === "error" && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
