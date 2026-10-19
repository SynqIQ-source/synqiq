"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type CurrentUserBannerProps = {
  displayName: string;
  role: "admin" | "instructor";
};

export function CurrentUserBanner({ displayName, role }: CurrentUserBannerProps) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 text-sm text-foreground">
      <span>
        Logged in as <span className="font-medium text-foreground">{displayName}</span>{" "}
        <span className="text-muted-foreground">({role})</span>
      </span>
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
      >
        Log out
      </button>
    </div>
  );
}
