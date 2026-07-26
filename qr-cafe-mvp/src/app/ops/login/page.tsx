"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

export default function OpsLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void supabase.auth.getUser().then(({ data }) => {
        if (String(data.user?.app_metadata?.role || "") === "ops") router.replace("/ops");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) {
      setMessage("운영자 계정 정보를 확인해 주세요.");
      setLoading(false);
      return;
    }
    if (String(data.user.app_metadata?.role || "") !== "ops") {
      await supabase.auth.signOut();
      setMessage("OPS 권한이 등록된 운영자 계정만 접근할 수 있습니다.");
      setLoading(false);
      return;
    }
    router.replace("/ops");
    router.refresh();
  };

  return (
    <main className="opsLoginWrap">
      <style jsx global>{`
        *{box-sizing:border-box}body{margin:0;background:#0f172a;color:#172033;font-family:Arial,"Noto Sans KR",sans-serif}.opsLoginWrap{min-height:100dvh;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 20% 10%,#294a86 0,transparent 35%),#0f172a}.opsLoginCard{width:min(430px,100%);background:#fff;border-radius:22px;padding:30px;box-shadow:0 30px 90px rgba(0,0,0,.35);display:grid;gap:18px}.opsLoginCard h1{margin:4px 0 0;font-size:28px}.opsLoginCard p{margin:0;color:#667085;line-height:1.6}.opsEyebrow{color:#2457d6;font-size:11px;font-weight:900;letter-spacing:1.7px}.opsField{display:grid;gap:7px;font-size:13px;font-weight:800}.opsInput{width:100%;min-height:48px;border:1px solid #d0d5dd;border-radius:12px;padding:0 13px;font-size:15px}.opsSubmit{min-height:50px;border:0;border-radius:12px;background:#2457d6;color:#fff;font-weight:900;font-size:15px;cursor:pointer}.opsSubmit:disabled{opacity:.55}.opsError{padding:12px;border:1px solid #fecdca;background:#fef3f2;color:#b42318;border-radius:12px;font-size:13px;font-weight:700}.opsSecurity{padding-top:14px;border-top:1px solid #e4e7ec;font-size:12px!important}@media(max-width:520px){.opsLoginCard{padding:23px;border-radius:18px}}
      `}</style>
      <form className="opsLoginCard" onSubmit={submit}>
        <div><span className="opsEyebrow">LEON ORDER SECURE OPS</span><h1>운영자 로그인</h1></div>
        <p>전체 매장과 구독·결제 설정을 다루는 보호된 운영자 공간입니다.</p>
        <label className="opsField"><span>운영자 이메일</span><input className="opsInput" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)}/></label>
        <label className="opsField"><span>비밀번호</span><input className="opsInput" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)}/></label>
        {message ? <div className="opsError" role="alert">{message}</div> : null}
        <button className="opsSubmit" type="submit" disabled={loading}>{loading ? "권한 확인 중..." : "OPS 로그인"}</button>
        <p className="opsSecurity">권한은 사용자가 변경할 수 없는 서버 관리 정보로 확인합니다. 공용 기기에서는 작업 후 반드시 로그아웃해 주세요.</p>
      </form>
    </main>
  );
}
