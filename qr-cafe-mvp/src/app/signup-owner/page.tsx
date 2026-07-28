"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import DaumPostcodeEmbed, { Address } from "react-daum-postcode";
import Link from "next/link";
import AuthShell from "@/app/_components/AuthShell";

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
    <AuthShell eyebrow="OWNER ACCOUNT" title="점주 회원가입" description="점주 계정을 만든 다음 매장 정보와 메뉴 설정을 이어갈 수 있습니다." footer={<><Link href="/signup">가입 유형 다시 선택</Link><span> · </span><Link href="/login">로그인</Link></>}>
      {msg ? <p className="authMessage" role="alert">{msg}</p> : null}
      <form onSubmit={onSubmit}>
        <p className="authSectionTitle">계정 정보</p>
        <label className="authField">이메일<input className="authInput" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required placeholder="example@email.com" /></label>
        <label className="authField">비밀번호<input className="authInput" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" required placeholder="안전한 비밀번호를 입력해 주세요" /></label>
        <div className="authDivider" />
        <p className="authSectionTitle">대표자 정보</p>
        <label className="authField">이름<input className="authInput" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required placeholder="이름을 입력해 주세요" /></label>
        <label className="authField">전화번호<input className="authInput" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required placeholder="010-0000-0000" /></label>
        <label className="authField">주소<span className="authRow"><input className="authInput" value={address} readOnly placeholder="주소 검색으로 입력" />
            <button
              type="button"
              onClick={openAddressSearch}
              className="addressButton"
              disabled={loading}
            >
              주소 검색
            </button>
          </span></label>
          <label className="authField">상세 주소<input
            className="authInput"
            id="addressDetailInput"
            value={addressDetail}
            onChange={(e) => setAddressDetail(e.target.value)}
            placeholder="선택 사항 · 예: 101동 1203호"
          /></label>
        <button type="submit" disabled={loading} className="authButton">
          {loading ? "가입 처리 중..." : "점주 계정 만들기"}
        </button>
      </form>

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
      <style jsx>{`.addressButton{flex:0 0 auto;min-height:48px;padding:0 13px;border:1px solid #b8c8df;border-radius:12px;background:#f7f9fc;color:#294c78;font-weight:900;cursor:pointer}`}</style>
    </AuthShell>
  );
}

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
