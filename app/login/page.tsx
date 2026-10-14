import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeader } from "@/components/auth-header";
import { SiteFooter } from "@/components/site-footer";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Log in | SynqIQ",
  description: "Sign in to your SynqIQ staff account.",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <AuthHeader />
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
      <SiteFooter />
    </div>
  );
}
