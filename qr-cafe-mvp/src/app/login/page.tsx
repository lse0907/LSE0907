"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialError = sp.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string>(initialError || "");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    if (!email.trim() || !password) {
      setMsg("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    router.push("/admin");
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
          type="email"
          required
          placeholder="이메일"
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
        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>

      <div style={{ marginTop: 14 }}>
        <a href="/signup" style={{ fontWeight: 900 }}>
          회원가입
        </a>
      </div>

      <div style={{ marginTop: 18 }}>
        <a href="/" style={{ color: "#6b7280", fontWeight: 800 }}>
          홈으로
        </a>
      </div>
    </main>
  );
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
