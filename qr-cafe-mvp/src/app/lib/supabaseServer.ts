// src/app/lib/supabaseServer.ts
import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try {
            (cookieStore as any).set({ name, value, ...options });
          } catch {}
        },
        remove(name: string, options: any) {
          try {
            (cookieStore as any).set({ name, value: "", ...options });
          } catch {}
        },
      },
    }
  );
}
