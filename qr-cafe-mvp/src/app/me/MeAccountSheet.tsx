"use client";
import Link from "next/link";
import { CustomerSheet } from "../_components/CustomerSheet";
import { CustomerIcon } from "../_components/CustomerIcon";
function maskEmail(value: string) {
  const [name, domain] = value.split("@");
  if (!domain) return value || "-";
  return `${name.slice(0, 2)}***@${domain}`;
}
function maskPhone(value: string) {
  const parts = value.split("-");
  return parts.length === 3 ? `${parts[0]}-****-${parts[2]}` : value || "-";
}
export function MeAccountSheet({
  email,
  name,
  phone,
  editing,
  editName,
  editPhone,
  saving,
  signingOut,
  error,
  notice,
  onEdit,
  onCancel,
  onNameChange,
  onPhoneChange,
  onSave,
  onSignOut,
  onClose,
}: {
  email: string;
  name?: string | null;
  phone?: string | null;
  editing: boolean;
  editName: string;
  editPhone: string;
  saving: boolean;
  signingOut: boolean;
  error: string;
  notice: string;
  onEdit: () => void;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onSave: () => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  return (
    <CustomerSheet title="계정 정보" icon="user" onClose={onClose}>
      {editing ? (
        <div className="accountForm">
          <label>
            이메일
            <input value={email} readOnly aria-readonly="true" />
          </label>
          <small>이메일은 현재 화면에서 변경할 수 없어요.</small>
          <label>
            이름
            <input
              value={editName}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
          <label>
            전화번호
            <input
              inputMode="tel"
              value={editPhone}
              onChange={(event) => onPhoneChange(event.target.value)}
            />
          </label>
          {error ? (
            <p className="accountError" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="accountNotice" role="status">
              {notice}
            </p>
          ) : null}
          <div className="accountActions">
            <button
              type="button"
              className="accountSecondary"
              onClick={onCancel}
              disabled={saving}
            >
              취소
            </button>
            <button
              type="button"
              className="sheetAction"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      ) : (
        <div className="accountSummary">
          <dl className="accountDetails">
            <div><dt>이메일</dt><dd>{maskEmail(email)}</dd></div>
            <div><dt>이름</dt><dd>{name || "미등록"}</dd></div>
            <div><dt>전화번호</dt><dd>{phone ? maskPhone(phone) : "미등록"}</dd></div>
          </dl>
          {error ? (
            <p className="accountError" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="accountNotice" role="status">
              {notice}
            </p>
          ) : null}
          <button type="button" className="sheetAction" onClick={onEdit}>
            정보 수정
          </button>
          <nav className="accountLinks" aria-label="계정 관리 메뉴">
            <Link href="/account">
              <span><CustomerIcon name="user" size={18} />내 계정 관리</span>
              <CustomerIcon name="chevronRight" size={16} />
            </Link>
            <Link href="/account/services/add/owner">
              <span><CustomerIcon name="store" size={18} />사업자 서비스 시작하기</span>
              <CustomerIcon name="chevronRight" size={16} />
            </Link>
          </nav>
          <button
            type="button"
            className="logoutButton"
            onClick={onSignOut}
            disabled={signingOut}
          >
            <CustomerIcon name="logout" size={18} />
            <span>{signingOut ? "로그아웃 중..." : "로그아웃"}</span>
          </button>
        </div>
      )}
      <style jsx>{`
        .accountSummary {
          display: grid;
          gap: 14px;
        }
        .accountDetails {
          margin: 0;
          padding: 0 14px;
          border: 1px solid #e1e7ef;
          border-radius: 14px;
          background: #f8fafc;
        }
        .accountDetails > div {
          display: grid;
          grid-template-columns: 70px minmax(0, 1fr);
          align-items: baseline;
          gap: 12px;
          padding: 13px 0;
          border-bottom: 1px solid #e1e7ef;
        }
        .accountDetails > div:last-child {
          border-bottom: 0;
        }
        .accountDetails dt {
          color: #667085;
          font-size: 12px;
        }
        .accountDetails dd {
          margin: 0;
          color: #172b4b;
          font-size: 14px;
          font-weight: 750;
          overflow-wrap: anywhere;
        }
        .accountSummary > .sheetAction {
          margin-top: 0;
        }
        .accountLinks {
          display: grid;
          border: 1px solid #e1e7ef;
          border-radius: 14px;
          overflow: hidden;
        }
        .accountLinks :global(a) {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          min-height: 50px;
          padding: 10px 14px;
          background: #fff;
          color: #405a7c;
          font-size: 13px;
          font-weight: 700;
          text-decoration: none;
          border-bottom: 1px solid #e1e7ef;
        }
        .accountLinks :global(a:last-child) {
          border-bottom: 0;
        }
        .accountLinks span {
          display: flex;
          align-items: center;
          gap: 8px;
          word-break: keep-all;
        }
        .accountLinks :global(svg) {
          flex-shrink: 0;
        }
        .accountLinks :global(a:focus-visible) {
          outline-offset: -3px;
        }
        .accountSummary > .logoutButton {
          border-color: transparent;
          background: transparent;
          color: #667085;
          font-size: 13px;
        }
      `}</style>
    </CustomerSheet>
  );
}
