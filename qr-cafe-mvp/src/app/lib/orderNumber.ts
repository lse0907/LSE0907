export function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function nextDailySequence() {
  const key = todayKey();

  const lastDate = localStorage.getItem("qrCafe_seqDate");
  let seq = Number(localStorage.getItem("qrCafe_seqValue") || "0");

  if (lastDate !== key) {
    seq = 0;
    localStorage.setItem("qrCafe_seqDate", key);
  }

  seq += 1;
  if (seq > 9999) seq = 9999;

  localStorage.setItem("qrCafe_seqValue", String(seq));
  return seq;
}

export function format4(n: number) {
  return String(n).padStart(4, "0");
}
