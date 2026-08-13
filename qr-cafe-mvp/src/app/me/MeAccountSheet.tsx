"use client";
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
    <CustomerSheet title="계정 정보" onClose={onClose}>
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
        <div className="sheetCard accountSummary">
          <p>
            <b>이메일</b>
            <br />
            {maskEmail(email)}
          </p>
          <p>
            <b>이름</b>
            <br />
            {name || "-"}
          </p>
          <p>
            <b>전화번호</b>
            <br />
            {maskPhone(phone || "")}
          </p>
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
          <hr />
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
    </CustomerSheet>
  );
}
