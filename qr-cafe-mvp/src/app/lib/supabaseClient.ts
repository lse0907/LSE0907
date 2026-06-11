// src/app/lib/supabaseClient.ts
import { createBrowserClient } from "@supabase/ssr";

const fallbackSupabaseUrl = "https://example.supabase.co";
const fallbackSupabaseAnonKey = "preview-build-placeholder-key";

export const isSupabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || fallbackSupabaseUrl;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fallbackSupabaseAnonKey;

// 브라우저에서만 사용하는 Client (로그인 UI, 클라이언트 쿼리 등에 사용)
// Preview/CI 환경에 Supabase env가 빠져도 Next.js 정적 프리렌더 단계가 중단되지 않도록
// placeholder client를 생성합니다. 실제 배포 환경에서는 Vercel env 값을 반드시 사용합니다.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
