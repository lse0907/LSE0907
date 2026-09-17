# OpenAI API 연결 체크리스트

상태: **연결 검증 완료 · 외부 호출 비활성화 유지**

실제 브리핑 제한 운영 절차는 [AI 브리핑 제한 운영 기록](./ai-limited-operation-runbook.md)을 기준으로 한다. 전체 완료·보류 상태는 [AI 현재 운영 체크리스트](./ai-current-operation-checklist.md)를 우선한다.

이 문서는 API 키를 만들고 연결할 수 있는 시점에만 사용한다. 외부 호출은
명시적인 검증·베타 운영 시간에만 제한적으로 켠다.

## 준비가 되었을 때의 순서

1. 리온오더 운영 전용 OpenAI 계정의 결제수단과 최소 크레딧 등록을 확인한다.
2. OpenAI Platform에서 서비스 전용 API 키를 만든다. 키 값은 한 번만 확인할 수
   있으므로 비밀번호 관리자에 보관하고 채팅·문서·소스 코드에는 적지 않는다.
3. Vercel의 Production·Preview·Development 환경에 각각 아래 이름으로 등록한다.
   - `OPENAI_API_KEY`: 실제 키 값
   - `AI_EXTERNAL_CALLS_ENABLED`: 처음에는 반드시 `false`
4. 로컬 또는 Preview에서 `npm run check:ai-provider-readiness`를 실행한다.
   키 내용은 출력되지 않으며, 외부 OpenAI API도 호출하지 않는다.
5. 승인 후에만 `AI_EXTERNAL_CALLS_ENABLED=true`로 바꾸고,
   `npm run check:ai-provider-readiness -- --require-ready`를 실행한다.
6. 첫 실제 호출은 베타 매장 한 곳의 집계 데이터만 사용해 수행한다. 호출 장부,
   40달러 중지 규칙, OPS 표시, 오류 시 기존 주문 기능 유지 여부를 함께 확인한다.

## Preview 실패 검증

실제 키를 틀리게 바꾸거나 네트워크를 끊어 운영 오류를 만들지 않는다. Preview
배포에만 `AI_PROVIDER_PREVIEW_FAILURE_TESTS=true`를 추가한 뒤, OPS master가
인증 실패·요청 과다·시간 초과의 처리 결과를 시뮬레이션한다. 이 경로는 OpenAI를
호출하지 않고 비용을 0으로 기록하며, Production에서는 항상 404를 반환한다.

## 절대 하지 않는 것

- 브라우저 코드, GitHub, 문의 첨부, 브리핑 본문에 API 키를 넣지 않는다.
- 결제·환불·코드·DB 변경을 API 호출로 자동 실행하지 않는다.
- 고객 이름, 전화번호, 주소, 결제정보, 주문 요청 원문을 AI에 보내지 않는다.

## 현재 상태

- `OPENAI_API_KEY`: Vercel 서버 환경변수 연결 완료
- 첫 실제 고정 집계 호출: 성공, 실제 장부 비용 `$0.000168`
- `AI_EXTERNAL_CALLS_ENABLED`: 검증 후 비활성화 상태로 원복
- 전역/매장 차단 및 40/50달러 한도: 원격 DB 검증 완료
- Preview 실패 시뮬레이션: 코드 반영 후 별도 검증 예정
