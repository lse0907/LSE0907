const requireReady = process.argv.includes("--require-ready");
const hasKey = Boolean((process.env.OPENAI_API_KEY || "").trim());
const externalCallsEnabled = process.env.AI_EXTERNAL_CALLS_ENABLED === "true";

if (externalCallsEnabled && !hasKey) {
  throw new Error("AI_EXTERNAL_CALLS_ENABLED=true 이지만 OPENAI_API_KEY가 없습니다. 외부 호출은 활성화하지 않았습니다.");
}
if (requireReady && (!hasKey || !externalCallsEnabled)) {
  throw new Error("연결 준비가 완료되지 않았습니다. API 키와 외부 호출 활성화 여부를 확인해 주세요.");
}

if (hasKey && !externalCallsEnabled) {
  console.log("OpenAI API 키는 감지됐지만 외부 호출은 안전하게 꺼져 있습니다.");
} else if (hasKey && externalCallsEnabled) {
  console.log("OpenAI 연결 준비가 완료되었습니다. 이 점검은 외부 API를 호출하지 않습니다.");
} else {
  console.log("OpenAI API 키가 아직 연결되지 않았습니다. 현재는 외부 AI 호출이 안전하게 꺼져 있습니다.");
}
