import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./storeAuth";

export type OpsRole = "master" | "billing" | "support" | "viewer";

export async function requireOpsUser(req: NextRequest, supabaseAdmin: SupabaseClient, allowedRoles?: OpsRole[]) {
  const authorization = req.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  let userResult;
  if (bearer) {
    userResult = await supabaseAdmin.auth.getUser(bearer);
  } else {
    const { createServerClient } = await import("@supabase/ssr");
    const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "");
    const anon = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
    const client = createServerClient(url, anon, { cookies: { get: (name: string) => req.cookies.get(name)?.value, set() {}, remove() {} } });
    userResult = await client.auth.getUser();
  }
  const user = userResult.data?.user;
  if (userResult.error || !user) throw new ApiError(401, "OPS 로그인이 필요합니다.", "OPS_LOGIN_REQUIRED");
  if (String(user.app_metadata?.role || "") !== "ops") throw new ApiError(403, "OPS 권한이 없습니다.", "OPS_FORBIDDEN");
  const rawRole = String(user.app_metadata?.ops_role || "viewer");
  const opsRole: OpsRole = rawRole === "master" || rawRole === "billing" || rawRole === "support" ? rawRole : "viewer";
  if (allowedRoles?.length && !allowedRoles.includes(opsRole)) {
    throw new ApiError(403, "이 OPS 작업을 수행할 권한이 없습니다.", "OPS_ROLE_FORBIDDEN");
  }
  return { userId: user.id, email: user.email || "", opsRole };
}
