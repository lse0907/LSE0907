import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type StoreRole = "owner" | "manager" | "staff" | "viewer";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "API_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type StoreMemberRow = {
  store_id: string | null;
  user_id: string | null;
  role: string | null;
};

export function createSupabaseAdminClient() {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const serviceRole =
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

  if (!supabaseUrl || !serviceRole) {
    throw new ApiError(500, "서버 환경변수(SUPABASE)가 필요합니다.", "MISSING_SUPABASE_ENV");
  }

  return createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createRequestSupabaseClient(req: NextRequest) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!supabaseUrl || !anonKey) {
    throw new ApiError(500, "서버 환경변수(SUPABASE ANON)가 필요합니다.", "MISSING_SUPABASE_ANON_ENV");
  }

  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });
}

async function getRequestUserId(req: NextRequest) {
  const supabase = createRequestSupabaseClient(req);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    throw new ApiError(401, "로그인이 필요합니다.", "LOGIN_REQUIRED");
  }
  return data.user.id;
}

export function normalizeRole(raw: string | null | undefined): StoreRole {
  const role = String(raw || "").trim().toLowerCase();
  if (role === "owner" || role === "manager" || role === "staff" || role === "viewer") return role;
  return "viewer";
}

export async function requireStoreRole(params: {
  req: NextRequest;
  supabaseAdmin: SupabaseClient;
  storeId: string;
  allowedRoles: StoreRole[];
}) {
  const storeId = String(params.storeId || "").trim();
  if (!storeId) throw new ApiError(400, "매장 정보가 없습니다.", "STORE_REQUIRED");

  const userId = await getRequestUserId(params.req);
  const { data, error } = await params.supabaseAdmin
    .from("store_members")
    .select("store_id,user_id,role")
    .eq("store_id", storeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new ApiError(500, `매장 권한 확인 실패: ${error.message}`, "STORE_ROLE_CHECK_FAILED");
  if (!data) throw new ApiError(403, "이 매장에 대한 권한이 없습니다.", "STORE_ROLE_FORBIDDEN");

  const member = data as StoreMemberRow;
  const role = normalizeRole(member.role);
  if (!params.allowedRoles.includes(role)) {
    throw new ApiError(403, "이 작업을 수행할 권한이 없습니다.", "STORE_ROLE_NOT_ALLOWED");
  }

  return { userId, storeId, role };
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, code: error.code, message: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ ok: false, message }, { status: 500 });
}
