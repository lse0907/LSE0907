# AI Preview 오류 검증 운영 기록

이 문서는 RION Order AI 기능의 Preview 전용 오류 검증을 다시 실행할 때 사용하는 **영구 운영 기록**이다. 대화의 기억이 아니라 이 문서를 기준으로 상태와 절차를 확인한다.

## 현재 기준 상태

- Preview 오류 검증 스위치: **비활성** (`AI_PROVIDER_PREVIEW_FAILURE_TESTS=false`)
- 전역 AI: 중지
- OpenAI 월 자동 중지 / 절대 상한: `$40 / $50`
- `testximen`: `suspended`, AI 중지
- `testximen4`: `not_enrolled`, AI 중지
- 실제 OpenAI 연결 확인: 고정된 `0건 / 0원` 집계로 1회 성공 검증 완료
- Preview 실패 처리 검증: 아래 세 유형 모두 `failed`, 실제 비용 `$0.000000`으로 기록 완료
  - `AI_PROVIDER_AUTH_FAILED`
  - `AI_PROVIDER_RATE_LIMITED`
  - `AI_PROVIDER_TIMEOUT`

## 왜 기본 비활성인가

실패 기록 검증은 실제 OpenAI를 호출하지 않지만, 운영 장부와 AI 제어 상태를 일시적으로 바꾼다. 따라서 평상시에는 경로를 닫고, 배포 전 또는 장애 대응 리허설 때만 제한적으로 연다.

이 기능은 다음 조건이 모두 맞아야만 동작한다.

1. Vercel Preview 배포
2. `AI_PROVIDER_PREVIEW_FAILURE_TESTS=true`
3. 동일 출처 요청
4. OPS `MASTER` 계정

Production에는 이 검증 경로를 열지 않는다.

## 재검증 전 체크리스트

- [ ] 재검증 목적과 대상 배포를 OPS 책임자가 승인했다.
- [ ] Preview 배포에서만 진행한다. Production URL에서는 진행하지 않는다.
- [ ] `AI_PROVIDER_PREVIEW_FAILURE_TESTS` 값을 Preview에만 `true`로 설정했다.
- [ ] Vercel의 **System Environment Variables 접근**이 켜져 있다. (`VERCEL_ENV=preview` 확인에 필요)
- [ ] 별도 테스트 매장을 사용한다. 기존 사용량 이력이 많은 매장을 재사용하지 않는다.
- [ ] 테스트 매장의 임시 분석 횟수·비용 한도는 예약 단계가 막히지 않도록 설정한다. 이 한도는 실제 청구 비용이 아니라 검증용 예약 한도다.
- [ ] 실제 OpenAI 호출 버튼을 누르지 않는다. Preview 오류 처리 검증 패널만 사용한다.

## 실행 절차

1. Preview 환경변수 값을 `true`로 바꾸고, **새 Preview 배포 또는 재배포**를 만든다.
2. Preview OPS에 `MASTER` 계정으로 로그인한다.
3. OPS → AI 운영 → 격리 테스트 매장을 연다.
4. `Preview 오류 처리 검증`에서 아래를 각각 선택하고, 화면 안의 `기록하기`를 한 번 더 눌러 실행한다.
   - 인증 실패
   - 요청 과다
   - 시간 초과
5. 사용량 장부에서 세 오류 코드가 모두 `failed`, 실제 비용 `0`으로 남았는지 확인한다.
6. 즉시 복구 절차를 실행한다.

## 반드시 수행할 복구 절차

- [ ] 전역 AI를 중지한다.
- [ ] 테스트 매장의 AI를 중지한다.
- [ ] 격리 테스트 매장은 원래 베타 상태로 돌린다. (`not_enrolled` 등)
- [ ] 전역 한도를 `$40 / $50` 기준으로 되돌린다.
- [ ] `AI_PROVIDER_PREVIEW_FAILURE_TESTS=false`로 다시 끈다.
- [ ] 새 Preview 배포가 필요하면 재배포하여 비활성 값을 반영한다.
- [ ] 최종적으로 전역/매장 AI 상태와 세 실패 기록의 비용이 모두 기대값인지 확인한다.

## 관련 코드

- Preview 실패 처리 API: `src/app/api/ops/ai-provider-check/preview-failure/route.ts`
- OPS 검증 UI: `src/app/ops/ai-usage/page.tsx`
- AI 실행 예약·완료 장부: `src/app/api/_lib/aiExecution.ts`

## 운영 원칙

- 이 절차는 실제 모델 장애를 의도적으로 일으키는 테스트가 아니다. 외부 호출 없이 동일한 예약·실패 완료·장부 기록 흐름을 검증한다.
- 실제 OpenAI 오류·시간초과는 비용·외부 의존성을 수반할 수 있으므로, 별도의 사전 승인이 있을 때만 제한적으로 검증한다.
- 검증 결과나 운영 기준이 바뀌면 이 문서를 먼저 갱신하고, 체크리스트 상태를 대화와 동일하게 맞춘다.
