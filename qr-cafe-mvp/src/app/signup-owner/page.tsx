"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import DaumPostcodeEmbed, { Address } from "react-daum-postcode";

function SignupOwnerPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialError = sp.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [showAddr, setShowAddr] = useState(false);
  const [msg, setMsg] = useState<string>(initialError || "");
  const [loading, setLoading] = useState(false);

  const openAddressSearch = () => setShowAddr(true);
  const closeAddressSearch = () => setShowAddr(false);

  const onCompleteAddress = (data: Address) => {
    const picked = (data.address || "").trim();
    setAddress(picked);
    closeAddressSearch();

    setTimeout(() => {
      const el = document.getElementById("addressDetailInput");
      if (el) (el as HTMLInputElement).focus();
    }, 50);
  };

  const validate = () => {
    if (!email.trim() || !password) return "이메일과 비밀번호를 입력해주세요.";
    if (!name.trim()) return "이름을 입력해주세요.";
    if (!phone.trim()) return "전화번호를 입력해주세요.";
    if (!address.trim()) return "주소(거주지)를 검색해서 선택해주세요.";
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

    const { error: profileErr } = await supabase.from("profiles").upsert(
      {
        user_id: userId,
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        address_detail: addressDetail.trim() ? addressDetail.trim() : null,
      },
      { onConflict: "user_id" }
    );

    setLoading(false);

    if (profileErr) {
      setMsg(`회원정보 저장 실패: ${profileErr.message}`);
      return;
    }

    router.push("/admin");
  };

  return (
    <main style={{ maxWidth: 460, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>점주 회원가입</h1>
      <p style={{ color: "#6b7280", marginTop: 8, fontWeight: 700, lineHeight: 1.4 }}>
        사장님 계정을 생성합니다. 주소(거주지)는 “주소 검색”으로 선택할 수 있어요.
      </p>

      {msg ? (
        <p style={{ color: "#b91c1c", fontWeight: 900, marginTop: 12, whiteSpace: "pre-wrap" }}>{msg}</p>
      ) : null}

      <form onSubmit={onSubmit} style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="이메일" style={inputStyle} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required placeholder="비밀번호" style={inputStyle} />

        <div style={dividerStyle} />

        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="이름 (필수)" style={inputStyle} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="전화번호 (필수)" style={inputStyle} />

        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ fontWeight: 900 }}>주소(거주지) (필수)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={address} readOnly placeholder="주소 검색으로 입력" style={{ ...inputStyle, flex: 1 }} />
            <button
              type="button"
              onClick={openAddressSearch}
              style={{ ...btnStyle, background: "#fff", color: "#111827" }}
              disabled={loading}
            >
              주소 검색
            </button>
          </div>

          <input
            id="addressDetailInput"
            value={addressDetail}
            onChange={(e) => setAddressDetail(e.target.value)}
            placeholder="상세주소 (선택) 예: 101동 1203호"
            style={inputStyle}
          />
        </div>

        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? "가입 처리 중..." : "가입하기"}
        </button>
      </form>

      <div style={{ marginTop: 14 }}>
        <a href="/login" style={{ fontWeight: 900 }}>
          로그인
        </a>
      </div>

      {showAddr ? (
        <div style={modalOverlayStyle} onClick={closeAddressSearch}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 16 }}>주소 검색</b>
              <button type="button" onClick={closeAddressSearch} style={closeBtnStyle}>
                닫기
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <DaumPostcodeEmbed onComplete={onCompleteAddress} autoClose={false} />
            </div>
            <p style={{ marginTop: 10, color: "#6b7280", fontWeight: 700, fontSize: 13, lineHeight: 1.4 }}>
              도로명 주소를 검색하고 선택하세요.
            </p>
          </div>
        </div>
      ) : null}
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

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: "#e5e7eb",
  margin: "4px 0",
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: 16,
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  width: "min(520px, 100%)",
  maxHeight: "85vh",
  overflow: "auto",
  background: "#fff",
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  padding: 14,
  boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
};

const closeBtnStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

export default function SignupOwnerPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <SignupOwnerPageInner />
    </Suspense>
  );
}
