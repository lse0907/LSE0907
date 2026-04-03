"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

function SignupCustomerPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialError = sp.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string>(initialError || "");
  const [loading, setLoading] = useState(false);

  const validate = () => {
    if (!email.trim() || !password) return "이메일과 비밀번호를 입력해주세요.";
    if (!name.trim()) return "이름을 입력해주세요.";
    if (!phone.trim()) return "전화번호를 입력해주세요.";
    return "";
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    const v = validate();
    if (v) {
      setMsg(v);
      return;
    }

    setLoading(true);

    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (signUpErr) {
      setLoading(false);
      setMsg(signUpErr.message);
      return;
    }

    if (!signUpData?.user) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) {
        setLoading(false);
        setMsg(`가입은 되었지만 자동 로그인에 실패했어요: ${signInErr.message}`);
        return;
      }
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      setLoading(false);
      setMsg("로그인 사용자 정보를 가져오지 못했어요. 다시 로그인 후 시도해주세요.");
      return;
    }

    const userId = userData.user.id;
    const { error: profileErr } = await supabase.from("customer_profiles").upsert(
      {
        user_id: userId,
        name: name.trim(),
        phone: phone.trim(),
      },
      { onConflict: "user_id" }
    );

    setLoading(false);

    if (profileErr) {
      setMsg(`고객정보 저장 실패: ${profileErr.message}`);
      return;
    }

    router.push("/me");
  };

  return (
    <main style={{ maxWidth: 460, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>고객 회원가입</h1>
      <p style={{ color: "#6b7280", marginTop: 8, fontWeight: 700, lineHeight: 1.4 }}>
        간편하게 가입하고, 매장별 포인트와 쿠폰 혜택을 받아보세요.
      </p>

      {msg ? (
        <p style={{ color: "#b91c1c", fontWeight: 900, marginTop: 12, whiteSpace: "pre-wrap" }}>{msg}</p>
      ) : null}

      <form onSubmit={onSubmit} style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="이메일" style={inputStyle} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required placeholder="비밀번호" style={inputStyle} />
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="이름 (필수)" style={inputStyle} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="전화번호 (필수)" style={inputStyle} />

        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? "가입 처리 중..." : "가입하고 혜택 받기"}
        </button>
      </form>

      <div style={{ marginTop: 14 }}>
        <a href="/login" style={{ fontWeight: 900 }}>
          로그인
        </a>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  fontWeight: 800,
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

export default function SignupCustomerPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <SignupCustomerPageInner />
    </Suspense>
  );
}
