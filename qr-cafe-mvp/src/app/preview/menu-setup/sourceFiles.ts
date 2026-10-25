export const MAX_CSV_BYTES = 5 * 1024 * 1024;

export function decodeCsv(bytes: ArrayBuffer): { text: string; encoding: string } {
  const data = new Uint8Array(bytes);
  const encoding = data[0] === 0xff && data[1] === 0xfe ? "utf-16le" : data[0] === 0xfe && data[1] === 0xff ? "utf-16be" : "utf-8";
  try { return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""), encoding }; }
  catch { return { text: new TextDecoder("euc-kr", { fatal: true }).decode(bytes), encoding: "euc-kr" }; }
}

export function csvFileIssue(name: string, size: number): string | null {
  if (!/\.csv$/i.test(name)) return "CSV 파일을 선택해주세요. 엑셀 파일은 CSV로 내려받아 첨부해주세요.";
  if (size === 0) return "내용이 없는 파일입니다. 다른 CSV 파일을 선택해주세요.";
  if (size > MAX_CSV_BYTES) return "미리보기는 CSV 파일 1개당 5MB까지 지원합니다.";
  return null;
}
