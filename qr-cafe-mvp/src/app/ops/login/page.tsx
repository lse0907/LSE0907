"use client";

import { FormEvent, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";
import RionBrand from "@/app/components/RionBrand";

const OPS_LOGIN_TIMEOUT_MS = 15_000;

type OpsLoginResponse = {
  user?: {
    app_metadata?: Record<string, unknown>;
  };
  error?: {
    message?: string;
  };
};

class OpsLoginTimeoutError extends Error {
  constructor() {
    super("OPS login timed out");
    this.name = "OpsLoginTimeoutError";
  }
}

function withLoginTimeout<T>(promise: PromiseLike<T>) {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new OpsLoginTimeoutError()), OPS_LOGIN_TIMEOUT_MS);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });
}

export default function OpsLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const signInRequest = fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    }).then(async (response) => ({
      ok: response.ok,
      result: (await response.json()) as OpsLoginResponse,
    }));
    let timedOut = false;

    void signInRequest.then(async ({ ok, result }) => {
      if (!timedOut || !ok || !result.user) return;
      if (String(result.user.app_metadata?.role || "") !== "ops") {
        await supabase.auth.signOut();
        return;
      }
      window.location.replace("/ops");
    }).catch(() => undefined);

    try {
      const { ok, result } = await withLoginTimeout(signInRequest);
      if (!ok || !result.user) {
        setMessage(result.error?.message || "운영자 계정 정보를 확인해 주세요.");
        return;
      }
      if (String(result.user.app_metadata?.role || "") !== "ops") {
        await supabase.auth.signOut();
        setMessage("OPS 권한이 등록된 운영자 계정만 접근할 수 있습니다.");
        return;
      }
      window.location.assign("/ops");
    } catch (error) {
      timedOut = error instanceof OpsLoginTimeoutError;
      setMessage(timedOut
        ? "인증 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요. 뒤늦게 로그인이 완료되면 OPS 홈으로 자동 이동합니다."
        : "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="opsLoginWrap">
      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#0f1f3d;color:#2b2f36}.opsLoginWrap{min-height:100dvh;display:grid;grid-template-columns:minmax(300px,.9fr) minmax(440px,1.1fr);background:#0f1f3d}.opsBrandPanel{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:clamp(36px,6vw,84px);color:#fff;background:linear-gradient(145deg,#0b172f,#0f1f3d 58%,#182f59)}.opsBrandPanel::before{content:"";position:absolute;width:540px;aspect-ratio:1;right:-170px;bottom:-150px;background:url("/brand/rion-symbol-watermark-white.svg") center/contain no-repeat;opacity:.04;pointer-events:none}.opsBrandPanel::after{content:"";position:absolute;width:440px;height:440px;right:-220px;bottom:-210px;border:1px solid rgba(255,255,255,.08);border-radius:50%;box-shadow:0 0 0 70px rgba(255,255,255,.018),0 0 0 140px rgba(255,255,255,.012)}.opsBrandMessage{position:relative;z-index:1;max-width:480px}.opsBrandMessage span{display:block;margin-bottom:14px;color:#b7c5dc;font-size:12px;font-weight:800;letter-spacing:.14em}.opsBrandMessage h2{margin:0 0 16px;font-size:clamp(30px,4vw,54px);line-height:1.08;letter-spacing:-.055em}.opsBrandMessage p{margin:0;color:#cbd5e1;font-size:15px;line-height:1.75}.opsLoginArea{display:grid;place-items:center;padding:clamp(24px,5vw,72px);background:#f4f6f9}.opsLoginCard{width:min(460px,100%);background:#fff;border:1px solid #e1e5eb;border-radius:18px;padding:clamp(24px,4vw,38px);box-shadow:0 24px 70px rgba(15,31,61,.12);display:grid;gap:20px}.opsLoginTitle{display:grid;gap:7px}.opsEyebrow{color:#52637d;font-size:11px;font-weight:900;letter-spacing:.14em}.opsLoginCard h1{margin:0;font-size:30px;letter-spacing:-.045em}.opsLoginCard p{margin:0;color:#667085;line-height:1.6}.opsField{display:grid;gap:8px;font-size:13px;font-weight:800}.opsInput{width:100%;min-height:50px;border:1px solid #cdd3dc;border-radius:11px;padding:0 14px;font-size:15px;outline:none;transition:border-color .18s,box-shadow .18s}.opsInput:focus{border-color:#0f1f3d;box-shadow:0 0 0 3px rgba(15,31,61,.12)}.opsSubmit{min-height:50px;border:0;border-radius:11px;background:#0f1f3d;color:#fff;font-weight:900;font-size:15px;cursor:pointer;transition:transform .18s,background .18s}.opsSubmit:hover:not(:disabled){background:#172e57;transform:translateY(-1px)}.opsSubmit:focus-visible{outline:3px solid #8da4c8;outline-offset:2px}.opsSubmit:disabled{opacity:.55;cursor:wait}.opsError{padding:12px;border:1px solid #fecdca;background:#fef3f2;color:#b42318;border-radius:11px;font-size:13px;font-weight:700}.opsSecurity{padding-top:16px;border-top:1px solid #e6e8eb;font-size:12px!important}.opsMobileBrand{display:none}@media(max-width:820px){.opsLoginWrap{display:block;padding:18px;background:linear-gradient(160deg,#0b172f,#0f1f3d 52%,#f4f6f9 52%)}.opsBrandPanel{display:none}.opsLoginArea{min-height:calc(100dvh - 36px);align-content:center;padding:18px;background:transparent}.opsMobileBrand{display:block;margin-bottom:22px}.opsLoginCard{border-radius:16px;padding:26px 22px}.opsLoginCard h1{font-size:27px}}@media(max-width:380px){.opsLoginWrap{padding:10px}.opsLoginArea{min-height:calc(100dvh - 20px);padding:10px}.opsLoginCard{padding:22px 18px}}
      `}</style>
      <section className="opsBrandPanel" aria-label="RION Order 소개">
        <RionBrand inverse />
        <div className="opsBrandMessage"><span>RION ORDER OPERATIONS</span><h2>운영의 모든 신호를<br/>한눈에 연결합니다.</h2><p>매장, 구독, 결제와 고객 문의를 안전하고 빠르게 관리하는 RION Order 통합 운영 콘솔입니다.</p></div>
      </section>
      <section className="opsLoginArea">
        <form className="opsLoginCard" onSubmit={submit}>
          <div className="opsMobileBrand"><RionBrand product /></div>
          <div className="opsLoginTitle"><span className="opsEyebrow">SECURE OPERATIONS</span><h1>운영자 로그인</h1></div>
          <p>RION Order 운영 권한이 등록된 계정으로 로그인해 주세요.</p>
          <label className="opsField"><span>운영자 이메일</span><input className="opsInput" type="email" autoComplete="username" inputMode="email" required disabled={loading} value={email} onChange={(event) => setEmail(event.target.value)}/></label>
          <label className="opsField"><span>비밀번호</span><input className="opsInput" type="password" autoComplete="current-password" required disabled={loading} value={password} onChange={(event) => setPassword(event.target.value)}/></label>
          {message ? <div className="opsError" role="alert">{message}</div> : null}
          <button className="opsSubmit" type="submit" disabled={loading}>{loading ? "권한 확인 중..." : "RION Order OPS 로그인"}</button>
          <p className="opsSecurity">이곳은 보호된 운영자 공간입니다. 공용 기기에서는 작업 후 반드시 로그아웃해 주세요.</p>
        </form>
      </section>
    </main>
  );
}
