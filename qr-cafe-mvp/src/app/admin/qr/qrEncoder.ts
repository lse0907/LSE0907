import QRCode from "qrcode";

/**
 * Returns a high-contrast PNG QR code for print layouts.
 *
 * QR payloads are business-critical: a hand-written encoder made a symbol that
 * looked correct but was not reliably recognized by phone cameras. Keep the
 * encoding itself in the maintained `qrcode` implementation and only render
 * its already-validated module matrix here.
 */
export function createQrDataUrl(text: string, pixelSize = 720) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const moduleCount = qr.modules.size;
  const quietZone = 4;
  const canvas = document.createElement("canvas");
  canvas.width = pixelSize;
  canvas.height = pixelSize;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("QR 캔버스를 만들 수 없습니다.");

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pixelSize, pixelSize);

  const cell = Math.floor(pixelSize / (moduleCount + quietZone * 2));
  const usedSize = cell * (moduleCount + quietZone * 2);
  const offset = Math.floor((pixelSize - usedSize) / 2) + quietZone * cell;
  ctx.fillStyle = "#111827";

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.modules.get(row, col)) ctx.fillRect(offset + col * cell, offset + row * cell, cell, cell);
    }
  }

  return canvas.toDataURL("image/png");
}
