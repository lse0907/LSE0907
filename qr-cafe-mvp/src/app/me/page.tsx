"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

type WalletRow = {
  store_id: string;
  point_balance: number;
  tier: "general" | "regular" | "vip" | string;
  lifetime_spent: number;
  lifetime_orders: number;
};

type ProfileRow = {
  name: string | null;
  phone: string | null;
};

function MePageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const storeFromQuery = useMemo(() => String(sp.get("store") || "").trim(), [sp]);
  const returnTo = useMemo(() => String(sp.get("return_to") || sp.get("next") || "").trim(), [sp]);

  const isSafeInternalPath = (v: string) => !!v && v.startsWith("/") && !v.startsWith("//");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg("");

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        router.replace("/login?next=/me");
        return;
      }

      const uid = userData.user.id;
      setEmail(String(userData.user.email || ""));

      const [profileRes, walletsRes] = await Promise.all([
        supabase.from("customer_profiles").select("name,phone").eq("user_id", uid).maybeSingle(),
        supabase
          .from("customer_store_wallets")
          .select("store_id, point_balance, tier, lifetime_spent, lifetime_orders")
          .eq("customer_user_id", uid)
          .order("updated_at", { ascending: false }),
      ]);

      if (profileRes.error) {
        setMsg(`고객 프로필 조회 실패: ${profileRes.error.message}`);
      } else {
        setProfile((profileRes.data as ProfileRow | null) || null);
      }

      if (walletsRes.error) {
        setMsg((prev) => (prev ? `${prev}\n` : "") + `포인트 지갑 조회 실패: ${walletsRes.error.message}`);
      } else {
        setWallets((walletsRes.data as WalletRow[]) || []);
      }

      setLoading(false);
    })();
  }, [router]);

  const summary = useMemo(() => {
    const totalPoints = wallets.reduce((acc, row) => acc + Math.max(0, Number(row.point_balance || 0)), 0);
    return { totalPoints, stores: wallets.length };
  }, [wallets]);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>회원 정보</h1>
        <button
          type="button"
          onClick={() => {
            if (isSafeInternalPath(returnTo)) {
              router.push(returnTo);
              return;
            }
            const sid = storeFromQuery || wallets[0]?.store_id || "";
            if (!sid) {
              router.push("/");
              return;
            }
            router.push(`/menu?store=${encodeURIComponent(sid)}`);
          }}
          style={actionBtnStyle}
        >
          주문화면
        </button>
      </div>
      <p style={{ color: "#6b7280", marginTop: 8, fontWeight: 700 }}>
        RION Order 회원 정보와 매장별 포인트를 확인할 수 있어요.
      </p>

      {loading ? <p style={{ marginTop: 14 }}>불러오는 중...</p> : null}
      {msg ? <p style={{ marginTop: 14, color: "#b91c1c", fontWeight: 800, whiteSpace: "pre-wrap" }}>{msg}</p> : null}

      {!loading ? (
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>기본 정보</h2>
          <p><b>이메일:</b> {email || "-"}</p>
          <p><b>이름:</b> {profile?.name || "-"}</p>
          <p><b>전화번호:</b> {profile?.phone || "-"}</p>
        </section>
      ) : null}

      {!loading ? (
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>요약</h2>
          <p><b>전체 포인트:</b> {summary.totalPoints.toLocaleString()}P</p>
          <p><b>혜택 매장 수:</b> {summary.stores}개</p>
        </section>
      ) : null}

      {!loading ? (
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>매장별 포인트</h2>
          {wallets.length === 0 ? (
            <p style={{ color: "#6b7280", fontWeight: 700 }}>아직 적립된 포인트가 없어요.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {wallets.map((w) => (
                <article key={w.store_id} style={walletItemStyle}>
                  <p style={{ margin: 0 }}><b>매장 ID:</b> {w.store_id}</p>
                  <p style={{ margin: "6px 0 0" }}><b>등급:</b> {w.tier}</p>
                  <p style={{ margin: "6px 0 0" }}><b>포인트:</b> {Number(w.point_balance || 0).toLocaleString()}P</p>
                  <p style={{ margin: "6px 0 0" }}><b>누적 결제:</b> {Number(w.lifetime_spent || 0).toLocaleString()}원</p>
                  <p style={{ margin: "6px 0 0" }}><b>주문 횟수:</b> {Number(w.lifetime_orders || 0)}회</p>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  marginTop: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 14,
};

const walletItemStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 900,
  margin: "0 0 10px",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

export default function MePage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <MePageInner />
    </Suspense>
  );
}
