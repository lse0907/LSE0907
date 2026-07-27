"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import RionBrand from "@/app/components/RionBrand";

type AdminPageHeaderProps = {
  title: string;
  description: string;
  storeId?: string | null;
  storeName?: string | null;
  eyebrow?: string;
  actions?: ReactNode;
};

export default function AdminPageHeader({ title, description, storeId, storeName, eyebrow = "STORE ADMIN", actions }: AdminPageHeaderProps) {
  const homeHref = storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin";

  return (
    <header className="adminPageHeader">
      <div className="brandLine">
        <RionBrand product admin compact />
        <span className="workspaceBadge">{eyebrow}</span>
      </div>
      <div className="pageLine">
        <div className="pageCopy">
          <span className="mobileEyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
          {storeName || storeId ? <span className="storeChip">현재 매장 · {storeName || storeId}</span> : null}
        </div>
        <div className="headerActions">
          {actions}
          <Link className="headerButton" href={homeHref}>관리자 홈</Link>
        </div>
      </div>
      <style jsx>{`
        .adminPageHeader{display:grid;gap:14px;padding:18px 20px;border:1px solid #dce4f0;border-radius:20px;background:linear-gradient(135deg,#fff 0%,#f7faff 100%);box-shadow:0 10px 28px rgba(30,55,90,.06)}
        .brandLine,.pageLine,.headerActions{display:flex;align-items:center}.brandLine{gap:10px}.workspaceBadge{padding:5px 8px;border:1px solid #cad8ec;border-radius:999px;color:#49617f;font-size:9px;font-weight:900;letter-spacing:.08em}.pageLine{justify-content:space-between;gap:18px}.pageCopy{min-width:0;display:grid;gap:5px}.mobileEyebrow{display:none;color:#4775b8;font-size:9px;font-weight:900;letter-spacing:.1em}.pageCopy h1{margin:0;color:#14213d;font-size:clamp(23px,2.5vw,31px);line-height:1.15;letter-spacing:-.04em}.pageCopy p{margin:0;color:#667085;font-size:13px;font-weight:650;line-height:1.45;word-break:keep-all}.storeChip{width:max-content;max-width:100%;overflow:hidden;padding:5px 9px;border-radius:999px;background:#edf4ff;color:#24589e;font-size:11px;font-weight:850;text-overflow:ellipsis;white-space:nowrap}.headerActions{flex:0 0 auto;gap:7px}.headerButton{min-height:40px;padding:9px 13px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #dce4f0;border-radius:12px;background:#fff;color:#14213d;font-family:inherit;font-size:12px;font-weight:850;text-decoration:none;white-space:nowrap}
        @media(max-width:640px){.adminPageHeader{gap:8px;padding:12px 14px;border-radius:16px}.brandLine{display:none}.pageLine{align-items:flex-start}.pageCopy{gap:3px}.mobileEyebrow{display:block}.pageCopy h1{font-size:21px}.pageCopy p{max-width:230px;overflow:hidden;font-size:11px;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}.storeChip{margin-top:3px;padding:4px 7px;font-size:10px}.headerActions{align-self:center}.headerButton{min-height:38px;padding:8px 10px;font-size:11px}}
      `}</style>
    </header>
  );
}
