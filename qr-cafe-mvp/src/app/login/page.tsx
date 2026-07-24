"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { getCurrentStoreId } from "../lib/currentStore";

function LoginPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialError = sp.get("error");
  const next = (sp.get("next") || "").trim();
  const storeForLogin = resolveStoreId(sp.get("store"), next);

  const readSavedLoginId = () => {
    try {
      if (typeof window === "undefined") return "";
      return window.localStorage.getItem("qrCafeRememberedLoginId") || "";
    } catch {
      return "";
    }
  };
  const [email, setEmail] = useState(() => readSavedLoginId());
  const [password, setPassword] = useState("");
  const [rememberLoginId, setRememberLoginId] = useState(() => !!readSavedLoginId());
  const [msg, setMsg] = useState<string>(initialError || "");
  const [loading, setLoading] = useState(false);

  const resolveSafeNext = (raw: string) => {
    if (!raw) return "";
    if (!raw.startsWith("/")) return "";
    if (raw.startsWith("//")) return "";
    return raw;
  };

  const toAuthEmail = (raw: string) => {
    const value = raw.trim().toLowerCase();
    if (value.includes("@")) return value;
    const safeStore = storeForLogin.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18) || "store";
    const safeLogin = value.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 48);
    return `${safeStore}.${safeLogin}@internal.qrcafe.local`;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    if (!email.trim() || !password) {
      setMsg("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    setLoading(true);
    const authEmail = toAuthEmail(email);
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password,
    });
    setLoading(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    try {
      if (rememberLoginId) window.localStorage.setItem("qrCafeRememberedLoginId", email.trim());
      else window.localStorage.removeItem("qrCafeRememberedLoginId");
    } catch {
      // ignore saved login id write errors
    }

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;

    if (!uid) {
      router.push("/login");
      return;
    }

    const { data: memberRows } = await supabase
      .from("store_members")
      .select("role")
      .eq("user_id", uid)
      .limit(10);

    const roles = (memberRows || []).map((row) => String(row.role || "").trim().toLowerCase());
    const hasOwnerRole = roles.includes("owner");
    const hasManagerRole = roles.includes("manager");
    const hasStaffRole = roles.includes("staff");

    const safeNext = resolveSafeNext(next);
    if (safeNext) {
      router.push(safeNext);
      return;
    }

    if (hasOwnerRole) router.push("/admin");
    else if (hasManagerRole || hasStaffRole) router.push("/staff");
    else router.push("/me");
  };

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>로그인</h1>

      {msg ? (
        <p style={{ color: "#b91c1c", fontWeight: 800, marginTop: 12 }}>{msg}</p>
      ) : null}

      <form onSubmit={onSubmit} style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="text"
          required
          placeholder="이메일 또는 매장 로그인 ID"
          style={inputStyle}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          placeholder="비밀번호"
          style={inputStyle}
        />
        <label
          htmlFor="rememberLoginId"
          style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#374151" }}
        >
          <input
            id="rememberLoginId"
            name="rememberLoginId"
            checked={rememberLoginId}
            onChange={(e) => setRememberLoginId(e.target.checked)}
            type="checkbox"
            style={{ width: 18, height: 18 }}
          />
          이 기기에 로그인 ID 저장
        </label>
        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>

      <div style={{ marginTop: 14 }}>
        <Link href="/signup" style={{ fontWeight: 900 }}>
          회원가입
        </Link>
      </div>

      <div style={{ marginTop: 18 }}>
        <Link href="/" style={{ color: "#6b7280", fontWeight: 800 }}>
          홈으로
        </Link>
      </div>
    </main>
  );
}


function resolveStoreId(rawStore: string | null, next: string) {
  try {
    const direct = String(rawStore || "").trim();
    if (direct) return direct;
    const current = getCurrentStoreId();
    if (current) return current;
    const url = new URL(next || "/", "https://local.invalid");
    return String(url.searchParams.get("store") || "").trim();
  } catch {
    return "";
  }
}

const inputStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  fontWeight: 700,
};

const btnStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <LoginPageInner />
    </Suspense>
  );
}
