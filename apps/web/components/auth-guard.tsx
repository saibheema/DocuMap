"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  // Track whether we have ever seen a logged-in user in this mount.
  // This prevents redirecting during the brief Firebase init window on
  // a full-page reload where auth.currentUser is momentarily null.
  const hadUser = useRef(!!user);
  if (user) hadUser.current = true;

  useEffect(() => {
    if (loading) return;
    if (!user && !hadUser.current) {
      router.replace("/");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
