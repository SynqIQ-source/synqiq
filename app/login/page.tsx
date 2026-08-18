import { Suspense } from "react";
import { AuthHeader } from "@/components/auth-header";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4">
      <AuthHeader />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
