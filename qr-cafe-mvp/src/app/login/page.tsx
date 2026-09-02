"use client";

import { Suspense, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "../lib/currentStore";
import AuthShell from "@/app/_components/AuthShell";
import { defaultViewerDestination, resolveViewerAccess } from "@/app/lib/viewerAccess";

type LoginResponse = {
  user?: User;
  accountLifecycleStatus?: string | null;
  error?: {
    message?: string;
  };
};

function LoginPageInner() {
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
  const [showPassword, setShowPassword] = useState(false);

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

    try {
      const authEmail = toAuthEmail(email);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: authEmail, password }),
      });
      const result = (await response.json()) as LoginResponse;

      if (!response.ok || !result.user) {
        setMsg(result.error?.message || "로그인에 실패했습니다.");
        return;
      }

      try {
        if (rememberLoginId) window.localStorage.setItem("qrCafeRememberedLoginId", email.trim());
        else window.localStorage.removeItem("qrCafeRememberedLoginId");
      } catch {
        // ignore saved login id write errors
      }

      if (result.accountLifecycleStatus && result.accountLifecycleStatus !== "active") {
        window.location.replace("/account/privacy?restricted=1");
        return;
      }

      const safeNext = resolveSafeNext(next);
      if (safeNext) {
        window.location.replace(safeNext);
        return;
      }

      const access = await resolveViewerAccess(result.user);
      window.location.replace(defaultViewerDestination(access));
    } catch {
      setMsg("로그인 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell eyebrow="WELCOME BACK" title="로그인" description="RION Order 계정으로 안전하게 로그인해 주세요." footer={<><Link href="/signup">계정이 없으신가요? 회원가입</Link><span> · </span><Link href="/">서비스 홈</Link></>}>
      {msg ? <p className="authMessage" role="alert">{msg}</p> : null}
      <form onSubmit={onSubmit}>
        <label className="authField">이메일 또는 매장 로그인 ID<input className="authInput" value={email} onChange={(e) => setEmail(e.target.value)} type="text" autoComplete="username" required placeholder="계정 ID를 입력해 주세요" /></label>
        <label className="authField">비밀번호<span className="authRow"><input className="authInput" value={password} onChange={(e) => setPassword(e.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" required placeholder="비밀번호를 입력해 주세요" /><button type="button" className="passwordToggle" onClick={() => setShowPassword((visible) => !visible)} aria-pressed={showPassword}>{showPassword ? "숨기기" : "보기"}</button></span></label>
        <label
          htmlFor="rememberLoginId"
          className="rememberRow"
        >
          <input
            id="rememberLoginId"
            name="rememberLoginId"
            checked={rememberLoginId}
            onChange={(e) => setRememberLoginId(e.target.checked)}
            type="checkbox"
          />
          이 기기에 로그인 ID 저장
        </label>
        <button type="submit" disabled={loading} className="authButton">
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>
      <style jsx>{`.rememberRow{display:flex;align-items:center;gap:8px;color:#43536a;font-size:12px;font-weight:800}.rememberRow input{width:18px;height:18px;accent-color:#173e73}.passwordToggle{flex:0 0 auto;min-height:48px;padding:0 13px;border:1px solid #d9e0eb;border-radius:12px;background:#f7f9fc;color:#294c78;font-weight:900;cursor:pointer}`}</style>
    </AuthShell>
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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <LoginPageInner />
    </Suspense>
  );
}
