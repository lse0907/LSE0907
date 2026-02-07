"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      await supabase.auth.signOut();
      router.replace("/login");
    })();
  }, [router]);

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 24 }}>
      <p style={{ fontWeight: 900 }}>로그아웃 중...</p>
    </main>
  );
}
