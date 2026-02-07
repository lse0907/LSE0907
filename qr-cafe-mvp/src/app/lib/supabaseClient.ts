// src/app/lib/supabaseClient.ts
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 브라우저에서만 사용하는 Client (로그인 UI, 클라이언트 쿼리 등에 사용)
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
