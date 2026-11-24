"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Camera, X } from "lucide-react";

// Member photos on the class roster: a camera button next to each member
// with a photo; clicking it shows the photo above the roster (click again,
// or the X, to hide it).

type Shown = { url: string; name: string } | null;
const PhotoContext = createContext<{
  shown: Shown;
  show: (next: Shown) => void;
}>({ shown: null, show: () => {} });

export function RosterPhotos({ children }: { children: ReactNode }) {
  const [shown, show] = useState<Shown>(null);
  return (
    <PhotoContext.Provider value={{ shown, show }}>
      {children}
    </PhotoContext.Provider>
  );
}

export function RosterPhotoPanel() {
  const { shown, show } = useContext(PhotoContext);
  if (!shown) return null;
  return (
    <div className="mx-6 mb-4 flex items-start gap-4 rounded-lg border bg-muted/40 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage or Mindbody photo */}
      <img
        src={shown.url}
        alt={shown.name}
        className="size-40 rounded-lg object-cover"
        referrerPolicy="no-referrer"
      />
      <div className="flex flex-1 items-start justify-between gap-2">
        <span className="font-medium">{shown.name}</span>
        <button
          type="button"
          onClick={() => show(null)}
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label="Hide photo"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function RosterPhotoButton({
  url,
  name,
}: {
  url: string | null | undefined;
  name: string;
}) {
  const { shown, show } = useContext(PhotoContext);
  if (!url) return null;
  const active = shown?.url === url;
  return (
    <button
      type="button"
      onClick={() => show(active ? null : { url, name })}
      className={`ml-1.5 inline-flex rounded p-1 align-middle hover:bg-accent ${active ? "text-primary" : "text-muted-foreground"}`}
      aria-label={active ? `Hide ${name}'s photo` : `Show ${name}'s photo`}
      title={active ? "Hide photo" : "Show photo"}
    >
      <Camera className="size-4" />
    </button>
  );
}
