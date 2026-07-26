# Billing Next Steps (합의안)

## 핵심 정책
- 과금 구조: 기본 월구독 + 선결제 기능(addon) 별도 과금.
- 결제 주기: 1개월 / 3개월 / 6개월 / 12개월 옵션.
- 기간 누적: 만료 전 선결제 시 남은 기간에 누적(rollover).
- 옵션도 기간제로 과금: addon 결제 시 `addon_paid_until`도 동일 기준으로 갱신.
- 권한: 결제/구독 설정 및 결제 실행은 owner 전용.
- 미결제 정책: 만료 즉시 기능 제한 + 매장 리스트에 남은 기간 노출.
- 정상 가격: 기본 14,900원 + 선결제 옵션 5,000원(부가세 포함).
- 장기 할인: 3개월 5%, 6개월 10%, 12개월 15%.
- 창립 멤버: 기본/옵션 별도 40%, 장기·다매장 할인과 중복하지 않음.
- 추가 매장: 기본 15%, 장기 할인 포함 총 25% 상한, 옵션 할인 없음.

## 데이터 모델(요약)
- `store_billing`
  - `base_plan_status`
  - `paid_until`
  - `current_plan_months`
- `store_addons`
  - `prepay_addon_status`
  - `addon_paid_until`
  - `current_plan_months`
- `billing_payments`
  - 결제 이력(플랜 개월 수, 결제금액, 결제시각, 누적 전/후 만료일)

## 서버 처리 규칙
- 결제 반영 함수에서 다음 규칙을 사용:
  - `anchor = max(now(), paid_until)`
  - `new_paid_until = anchor + plan_months`
- 결제 금액 계산 규칙(서버 강제):
  - `/api/billing/quote`가 가격 정책, 창립 멤버, 추가 매장, 기간 할인을 계산하고 서버 견적을 저장.
  - 토스 승인 시 브라우저 값이 아닌 저장된 서버 견적의 주문번호·금액·결제자를 검증.
  - 승인 성공과 구독 반영을 별도 상태로 저장하여 `approved_not_applied` 결제를 재처리 가능하게 유지.
- 결제 성공 시:
  - 기본 결제 포함이면 `store_billing.base_plan_status = active`, `paid_until` 갱신
  - addon 결제 포함이면 `store_addons.prepay_addon_status = active`, `addon_paid_until` 갱신
  - `billing_payments` 이력 1건 기록

## 적용 순서
1. 기존 기본 스키마가 없는 환경은 `docs/sql/supabase-billing-setup.sql`를 먼저 실행.
2. `docs/sql/supabase-billing-live-v2.sql` 전체를 Supabase SQL Editor에서 실행.
3. `docs/sql/supabase-billing-live-v2-1.sql` 전체를 실행해 OPS 저장과 선결제 ON/OFF를 보완.
4. `docs/sql/supabase-billing-live-v2-2.sql` 전체를 실행해 환불 이력, 실패 복구 RPC, OPS 환불 추적을 적용.
5. `docs/sql/supabase-billing-live-v2-3.sql` 전체를 실행해 과거 결제 상태 제약조건을 정리하고 `canceling` 전환을 허용.
6. 현재 운영 계정을 마스터로 쓸 때만 `docs/sql/supabase-ops-master-account.sql`의 이메일을 바꿔 전체 실행.
7. OPS 권한 변경 후 로그아웃·재로그인하고 owner 계정으로 서버 견적 → 토스 승인 → 즉시 취소 → OPS 이력 확인 흐름을 테스트.
3. UI에서 남은 기간/만료 상태를 읽어 노출.
4. owner 전용 결제 페이지(1/3/6/12개월 선택) 연결.

## 화면/역할 분리(확정 방향)
- 점주 admin:
  - `/admin/billing`은 설정 전용(PG 연결)으로 유지.
  - `/admin/billing/pay`에서 테스트 승인 체크 + 결제 실행을 처리.
- OPS 관리자 콘솔(PC 중심):
  - `/ops`에서 매장 가입/구독/구독매출 현황 확인.
  - 플랫폼 단일 PG 정보(MID/Client Key/Secret Key) 1회 입력.
  - 문의/장애 티켓 보드에서 상태(open/in_progress/resolved/closed)와 OPS 메모 처리.
  - 권한은 JWT `role=ops` 사용자로 제한(ops가 아닌 인증 사용자는 접근/수정 불가).

## 지원센터 워크플로(Phase 3)
- 점주 admin `/admin/support`
  - 매장 단위 티켓 등록(문의/오류/개선/결제/기타, 우선순위 포함)
  - 티켓 상태 및 OPS 응답 조회
- OPS `/ops`
  - 최신 티켓 목록 확인
  - 상태 전환(open/in_progress/resolved/closed)
  - OPS 처리 메모 저장
