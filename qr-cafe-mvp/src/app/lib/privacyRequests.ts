export const privacyTypes = { access: "개인정보 열람", correction: "개인정보 정정", deletion: "개인정보 삭제", restriction: "개인정보 처리정지" } as const;
export const privacyStatuses: Record<string, string> = { received: "접수", identity_verification_required: "추가 확인 필요", in_review: "검토 중", partially_completed: "일부 처리", completed: "완료", rejected: "처리 제한", canceled: "취소" };
export type PrivacyRequest = {
  id: string; subject_user_id: string | null; audience: "customer" | "owner";
  request_type: keyof typeof privacyTypes; status: string; requested_at: string;
  updated_at: string; decision_summary: string | null; request_detail?: { note?: string };
};
export type PrivacyEvent = { id: number; event_type: string; actor_type: string; actor_user_id: string | null; occurred_at: string; metadata: { from_status?: string; to_status?: string; action?: string } };
export type PrivacyDetail = { request: PrivacyRequest; events: PrivacyEvent[] };
export const privacyActions: Record<string, { label: string; description: string }> = {
  review: { label: "검토 중으로 변경", description: "회원에게 검토 진행 안내를 전달합니다. 개인정보는 변경하지 않습니다." },
  identity_required: { label: "추가 확인 요청", description: "필요한 확인 내용을 회원에게 안내합니다. 주민등록번호·비밀번호 입력을 요구하지 마세요." },
  reject: { label: "처리 제한 안내", description: "처리가 제한되는 구체적인 사유를 안내합니다. 개인정보는 변경하지 않습니다." },
  provide_profile_access: { label: "계정 기본정보 열람 제공", description: "회원 화면에 현재 이름·등록 연락처를 제공합니다. 주문·결제·사업자 증빙자료는 포함하지 않습니다." },
  correct_customer_name: { label: "고객 프로필 이름 정정", description: "고객 프로필의 이름만 변경합니다. 사업자 정보·과거 거래자료는 변경하지 않습니다." },
  correct_customer_phone: { label: "고객 선택 전화번호 정정", description: "고객 프로필의 선택 전화번호만 변경합니다. 로그인 인증·주문별 연락처는 변경하지 않습니다." },
  delete_customer_phone: { label: "고객 선택 전화번호 삭제", description: "고객 프로필의 선택 전화번호만 삭제합니다. 계정·주문·결제자료는 유지합니다." },
  restrict_marketing: { label: "마케팅 이용 중단", description: "선택한 서비스의 마케팅 동의를 철회합니다. 주문·결제·보안 등 필수 처리는 유지합니다." },
};
export function availablePrivacyActions(row: Pick<PrivacyRequest, "status" | "audience" | "request_type">): string[] {
  if (!["received", "identity_verification_required", "in_review", "partially_completed"].includes(row.status)) return [];
  const actions = ["review", "identity_required", "reject"];
  if (!["in_review", "partially_completed"].includes(row.status)) return actions;
  if (row.request_type === "access") actions.push("provide_profile_access");
  if (row.request_type === "restriction") actions.push("restrict_marketing");
  if (row.audience === "customer" && row.request_type === "correction") actions.push("correct_customer_name", "correct_customer_phone");
  if (row.audience === "customer" && row.request_type === "deletion") actions.push("delete_customer_phone");
  return actions;
}
export function isPrivacyExecution(action: string) { return !["review", "identity_required", "reject"].includes(action); }
export function validatePrivacyInput(action: string, summary: string, value: string): string | null {
  if (!Object.hasOwn(privacyActions, action)) return "처리 방법을 선택해 주세요.";
  if (summary.trim().length < 5 || summary.length > 1000) return "회원에게 전달할 안내를 5~1,000자로 입력해 주세요.";
  if (action === "correct_customer_name" && (!value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value))) return "정정할 이름을 1~80자로 입력해 주세요.";
  if (action === "correct_customer_phone" && !/^[0-9+ ()-]{8,24}$/.test(value.trim())) return "정정할 전화번호 형식을 확인해 주세요.";
  return null;
}
