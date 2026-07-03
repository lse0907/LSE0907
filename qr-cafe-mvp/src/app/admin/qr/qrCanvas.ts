import { createQrDataUrl } from "./qrEncoder";
import type { AdminQrDesignSettings, PaperPreset } from "./qrTypes";

export type TableSheetPreset = { label: string; cols: number; rows: number };

export type CounterPosterCanvasOptions = {
  design: AdminQrDesignSettings;
  preset: PaperPreset;
  counterPrintPreset: string;
  targetUrl: string;
  storeName: string;
  mainImage: string;
  logoImage: string;
};

export type TableSheetCanvasOptions = {
  design: AdminQrDesignSettings;
  preset: TableSheetPreset;
  tableNumbers: number[];
  storeName: string;
  logoImage: string;
  getTableUrl: (n: number) => string;
};

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    img.src = src;
  });
}

function trimMiddle(s: string, maxLen: number) {
  const str = String(s || "");
  if (str.length <= maxLen) return str;
  const head = Math.ceil((maxLen - 3) / 2);
  const tail = Math.floor((maxLen - 3) / 2);
  return `${str.slice(0, head)}...${str.slice(str.length - tail)}`;
}

function roundedClipPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
  stroke?: string
) {
  ctx.beginPath();
  roundedClipPath(ctx, x, y, w, h, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function formatTableLabel(n: number) {
  return `테이블 ${n}`;
}

function getCounterScale(counterPrintPreset: string) {
  if (counterPrintPreset === "a3_poster") return 1.35;
  if (counterPrintPreset === "a5_card") return 0.86;
  if (counterPrintPreset === "a4_2up") return 0.82;
  return 1;
}

function drawLogoBadge(
  ctx: CanvasRenderingContext2D,
  logoImg: HTMLImageElement | null,
  storeName: string,
  x: number,
  y: number,
  size: number,
  radius: number,
  bg = "#ffffff",
  textColor = "#111827",
  stroke?: string
) {
  roundRect(ctx, x, y, size, size, radius, bg, stroke);
  if (logoImg) {
    ctx.save();
    ctx.beginPath();
    roundedClipPath(ctx, x, y, size, size, radius);
    ctx.clip();
    ctx.drawImage(logoImg, x, y, size, size);
    ctx.restore();
    return;
  }
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${Math.round(size * 0.38)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
  ctx.fillText(storeName.trim().slice(0, 1) || "Q", x + size / 2, y + size / 2 + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawQrCard(ctx: CanvasRenderingContext2D, qrImg: HTMLImageElement, x: number, y: number, size: number, radius: number, stroke = "#e5e7eb") {
  const pad = Math.max(14, Math.round(size * 0.05));
  roundRect(ctx, x - pad, y - pad, size + pad * 2, size + pad * 2, radius, "#ffffff", stroke);
  ctx.drawImage(qrImg, x, y, size, size);
}

function fillCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const srcRatio = sw / sh;
  const dstRatio = w / h;
  let cropW = sw;
  let cropH = sh;
  let cropX = 0;
  let cropY = 0;

  if (srcRatio > dstRatio) {
    cropW = Math.floor(sh * dstRatio);
    cropX = Math.floor((sw - cropW) / 2);
  } else {
    cropH = Math.floor(sw / dstRatio);
    cropY = Math.floor((sh - cropH) / 2);
  }
  ctx.drawImage(img, cropX, cropY, cropW, cropH, x, y, w, h);
}

function drawWrappedLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineH: number, maxLines: number) {
  let dy = y;
  for (const line of lines.slice(0, maxLines)) {
    ctx.fillText(line, x, dy);
    dy += lineH;
  }
}

export async function createCounterPosterCanvas({
  design: ds,
  preset,
  counterPrintPreset,
  targetUrl,
  storeName,
  mainImage,
  logoImage,
}: CounterPosterCanvasOptions) {
  const A4_W = preset.width;
  const A4_H = preset.height;
  const copies = preset.copies || 1;
  const posterH = Math.floor(A4_H / copies);
  const scale = getCounterScale(counterPrintPreset);
  const padding = Math.max(36, Math.round(A4_W * 0.045 * scale));
  const qrMax = counterPrintPreset === "a3_poster" ? 620 : counterPrintPreset === "a4_poster" ? 470 : 320;

  const qrSrc = createQrDataUrl(targetUrl, 720);
  const qrImg = await loadImage(qrSrc).catch((e) => {
    throw new Error("QR 이미지 로드 실패\n" + String(e));
  });
  const heroImg = ds.show_main_image && mainImage ? await loadImage(mainImage).catch(() => null) : null;
  const logoImg = ds.show_logo && logoImage ? await loadImage(logoImage).catch(() => null) : null;

  const canvas = document.createElement("canvas");
  canvas.width = A4_W;
  canvas.height = A4_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas를 생성할 수 없습니다.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, A4_W, A4_H);

  const lines = (ds.counter_description || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  for (let i = 0; i < copies; i++) {
    const topY = i * posterH;
    const template = ds.template_key;
    const accent = ds.accent_color || "#111827";
    const logoSize = Math.round(76 * scale);
    const qrSize = Math.min(Math.round(A4_W * 0.32), Math.round(posterH * 0.36), qrMax);

    if (template === "cafe_poster") {
      const heroH = Math.round(posterH * 0.63);
      if (heroImg) fillCoverImage(ctx, heroImg, 0, topY, A4_W, heroH);
      else {
        const g = ctx.createLinearGradient(0, topY, A4_W, topY + heroH);
        g.addColorStop(0, accent);
        g.addColorStop(1, "#111827");
        ctx.fillStyle = g;
        ctx.fillRect(0, topY, A4_W, heroH);
      }
      const overlay = ctx.createLinearGradient(0, topY, 0, topY + heroH);
      overlay.addColorStop(0, "rgba(0,0,0,0.10)");
      overlay.addColorStop(1, "rgba(0,0,0,0.62)");
      ctx.fillStyle = overlay;
      ctx.fillRect(0, topY, A4_W, heroH);

      if (ds.show_logo) drawLogoBadge(ctx, logoImg, storeName, padding, topY + padding, logoSize, Math.round(18 * scale), "rgba(255,255,255,0.92)", "#111827");
      ctx.fillStyle = "#ffffff";
      ctx.font = `950 ${Math.round(46 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.show_store_name ? storeName : ds.counter_title, padding, topY + heroH - Math.round(92 * scale));
      ctx.font = `850 ${Math.round(24 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.counter_title, padding, topY + heroH - Math.round(52 * scale));

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, topY + heroH, A4_W, posterH - heroH);
      ctx.fillStyle = "#111827";
      ctx.font = `900 ${Math.round(20 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      drawWrappedLines(ctx, lines, padding, topY + heroH + Math.round(54 * scale), Math.round(30 * scale), 3);
      const qrX = A4_W - padding - qrSize;
      const qrY = topY + heroH + Math.round(((posterH - heroH) - qrSize) / 2);
      drawQrCard(ctx, qrImg, qrX, qrY, qrSize, Math.round(22 * scale), "#d1d5db");
      ctx.fillStyle = accent;
      ctx.fillRect(padding, topY + posterH - Math.round(24 * scale), A4_W - padding * 2, Math.max(4, Math.round(5 * scale)));
      if (ds.show_target_url) {
        ctx.fillStyle = "#6b7280";
        ctx.font = `800 ${Math.round(13 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
        ctx.fillText(trimMiddle(targetUrl, 70), padding, topY + posterH - Math.round(34 * scale));
      }
    } else if (template === "premium_dark") {
      const g = ctx.createLinearGradient(0, topY, A4_W, topY + posterH);
      g.addColorStop(0, "#020617");
      g.addColorStop(0.6, "#111827");
      g.addColorStop(1, "#030712");
      ctx.fillStyle = g;
      ctx.fillRect(0, topY, A4_W, posterH);
      ctx.fillStyle = accent;
      ctx.fillRect(padding, topY + padding, A4_W - padding * 2, Math.max(5, Math.round(6 * scale)));
      if (ds.show_logo) drawLogoBadge(ctx, logoImg, storeName, A4_W / 2 - logoSize / 2, topY + Math.round(96 * scale), logoSize, Math.round(999 * scale), "rgba(255,255,255,0.96)", "#111827", "rgba(255,255,255,0.22)");
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.68)";
      ctx.font = `900 ${Math.round(15 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText("SCAN & ORDER", A4_W / 2, topY + Math.round(65 * scale));
      ctx.fillStyle = "#ffffff";
      ctx.font = `950 ${Math.round(44 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.show_store_name ? storeName : ds.counter_title, A4_W / 2, topY + Math.round(220 * scale));
      ctx.font = `850 ${Math.round(22 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.fillText(ds.counter_title, A4_W / 2, topY + Math.round(260 * scale));
      const qrX = A4_W / 2 - qrSize / 2;
      const qrY = topY + Math.round(posterH * 0.46);
      drawQrCard(ctx, qrImg, qrX, qrY, qrSize, Math.round(26 * scale), "rgba(255,255,255,0.28)");
      ctx.font = `800 ${Math.round(18 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      drawWrappedLines(ctx, lines, A4_W / 2, qrY + qrSize + Math.round(58 * scale), Math.round(28 * scale), 2);
      if (ds.show_target_url) ctx.fillText(trimMiddle(targetUrl, 64), A4_W / 2, topY + posterH - Math.round(34 * scale));
      ctx.textAlign = "start";
    } else if (template === "soft_round") {
      ctx.fillStyle = "#fff7ed";
      ctx.fillRect(0, topY, A4_W, posterH);
      ctx.fillStyle = "rgba(251,146,60,0.16)";
      ctx.beginPath();
      ctx.arc(A4_W - padding, topY + padding, Math.round(150 * scale), 0, Math.PI * 2);
      ctx.fill();
      const cardX = padding;
      const cardY = topY + padding;
      const cardW = A4_W - padding * 2;
      const cardH = posterH - padding * 2;
      roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(42 * scale), "#ffffff", "#fed7aa");
      if (ds.show_logo) drawLogoBadge(ctx, logoImg, storeName, A4_W / 2 - logoSize / 2, cardY + Math.round(44 * scale), logoSize, Math.round(24 * scale), "#ffedd5", "#9a3412", "#fdba74");
      ctx.textAlign = "center";
      ctx.fillStyle = "#111827";
      ctx.font = `950 ${Math.round(38 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.show_store_name ? storeName : ds.counter_title, A4_W / 2, cardY + Math.round(160 * scale));
      ctx.fillStyle = "#9a3412";
      ctx.font = `850 ${Math.round(21 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.counter_title, A4_W / 2, cardY + Math.round(198 * scale));
      const qrX = A4_W / 2 - qrSize / 2;
      const qrY = cardY + Math.round(cardH * 0.42);
      drawQrCard(ctx, qrImg, qrX, qrY, qrSize, Math.round(30 * scale), "#fed7aa");
      ctx.fillStyle = "#57534e";
      ctx.font = `800 ${Math.round(18 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      drawWrappedLines(ctx, lines, A4_W / 2, qrY + qrSize + Math.round(54 * scale), Math.round(27 * scale), 2);
      if (ds.show_target_url) ctx.fillText(trimMiddle(targetUrl, 60), A4_W / 2, cardY + cardH - Math.round(30 * scale));
      ctx.textAlign = "start";
    } else {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, topY, A4_W, posterH);
      const cardX = padding;
      const cardY = topY + padding;
      const cardW = A4_W - padding * 2;
      const cardH = posterH - padding * 2;
      roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(24 * scale), "#ffffff", "#e5e7eb");
      if (ds.show_logo) drawLogoBadge(ctx, logoImg, storeName, A4_W / 2 - logoSize / 2, cardY + Math.round(42 * scale), logoSize, Math.round(18 * scale), "#f9fafb", "#111827", "#e5e7eb");
      ctx.textAlign = "center";
      ctx.fillStyle = "#111827";
      ctx.font = `950 ${Math.round(40 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.show_store_name ? storeName : ds.counter_title, A4_W / 2, cardY + Math.round(158 * scale));
      ctx.fillStyle = accent;
      ctx.font = `900 ${Math.round(22 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.counter_title, A4_W / 2, cardY + Math.round(198 * scale));
      const qrX = A4_W / 2 - qrSize / 2;
      const qrY = cardY + Math.round(cardH * 0.42);
      drawQrCard(ctx, qrImg, qrX, qrY, qrSize, Math.round(20 * scale), "#d1d5db");
      ctx.fillStyle = "#4b5563";
      ctx.font = `800 ${Math.round(18 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      drawWrappedLines(ctx, lines, A4_W / 2, qrY + qrSize + Math.round(52 * scale), Math.round(27 * scale), 2);
      if (ds.show_target_url) ctx.fillText(trimMiddle(targetUrl, 60), A4_W / 2, cardY + cardH - Math.round(30 * scale));
      ctx.textAlign = "start";
    }

    if (i < copies - 1) {
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, posterH);
      ctx.lineTo(A4_W, posterH);
      ctx.stroke();
    }
  }

  return canvas;
}

export async function createTableSheetCanvases({
  design: ds,
  preset,
  tableNumbers,
  storeName,
  logoImage,
  getTableUrl,
}: TableSheetCanvasOptions) {
  const A4_W = 1240;
  const A4_H = 1754;
  const COLS = preset.cols;
  const ROWS = preset.rows;
  const PER_PAGE = COLS * ROWS;
  const padding = 34;
  const gap = 18;
  const cardW = Math.floor((A4_W - padding * 2 - gap * (COLS - 1)) / COLS);
  const cardH = Math.floor((A4_H - padding * 2 - gap * (ROWS - 1)) / ROWS);
  const innerPad = 16;
  const labelH = 76;
  const qrSize = Math.min(240, cardW - innerPad * 2);
  const pages: number[][] = [];
  const tableLogoImg = ds.show_logo && logoImage ? await loadImage(logoImage).catch(() => null) : null;

  for (let i = 0; i < tableNumbers.length; i += PER_PAGE) pages.push(tableNumbers.slice(i, i + PER_PAGE));
  if (pages.length === 0) pages.push([]);

  const canvases: HTMLCanvasElement[] = [];
  for (const pageNums of pages) {
    const loaded = await Promise.all(
      pageNums.map((n) => {
        const url = getTableUrl(n);
        const src = createQrDataUrl(url, 720);
        return loadImage(src).then((img) => ({ n, img, url }));
      })
    );

    const canvas = document.createElement("canvas");
    canvas.width = A4_W;
    canvas.height = A4_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas를 생성할 수 없습니다.");

    const isPremium = ds.template_key === "premium_dark";
    const isPhoto = ds.template_key === "cafe_poster";
    const isRound = ds.template_key === "soft_round";
    const pageBg = isPremium ? "#0f172a" : isRound ? "#fff7ed" : isPhoto ? "#f8fafc" : "#ffffff";
    ctx.fillStyle = pageBg;
    ctx.fillRect(0, 0, A4_W, A4_H);
    ctx.fillStyle = isPremium ? "rgba(255,255,255,0.86)" : "#111827";
    ctx.font = "900 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
    ctx.fillText(`${ds.show_store_name ? storeName : ds.table_title} · 테이블 QR`, padding, 26);

    for (let i = 0; i < loaded.length; i++) {
      const row = Math.floor(i / COLS);
      const col = i % COLS;
      const x = padding + col * (cardW + gap);
      const y = padding + row * (cardH + gap) + 10;
      const cardRadius = isRound ? 28 : isPremium ? 22 : 16;
      const cardFill = isPremium ? "#111827" : isRound ? "#fffbeb" : "#ffffff";
      const cardStroke = isPremium ? "rgba(255,255,255,0.22)" : isPhoto ? ds.accent_color : isRound ? "#fed7aa" : "#e5e7eb";
      const titleColor = isPremium ? "#ffffff" : "#111827";
      const mutedColor = isPremium ? "rgba(255,255,255,0.72)" : "#6b7280";
      const brandFill = isPremium ? "rgba(255,255,255,0.10)" : isRound ? "#fed7aa" : isPhoto ? ds.accent_color : "#f9fafb";

      roundRect(ctx, x, y, cardW, cardH, cardRadius, cardFill, cardStroke);
      if (isPhoto) {
        const g = ctx.createLinearGradient(x, y, x + cardW, y + Math.max(64, Math.floor(cardH * 0.22)));
        g.addColorStop(0, ds.accent_color || "#111827");
        g.addColorStop(1, "#111827");
        roundRect(ctx, x + 1, y + 1, cardW - 2, Math.max(64, Math.floor(cardH * 0.22)), cardRadius, g);
      } else if (isRound || isPremium) {
        roundRect(ctx, x + innerPad, y + innerPad, cardW - innerPad * 2, 36, 18, brandFill);
      }

      const markSize = ds.show_logo ? (isPremium || isRound ? 38 : 30) : 0;
      const titleY = y + 30;
      if (isPremium || isRound) {
        if (ds.show_logo) {
          drawLogoBadge(
            ctx,
            tableLogoImg,
            storeName,
            x + Math.floor((cardW - markSize) / 2),
            y + 14,
            markSize,
            isRound ? 16 : 999,
            isPremium ? "rgba(255,255,255,0.96)" : "#ffedd5",
            isPremium ? "#111827" : "#9a3412",
            isPremium ? "rgba(255,255,255,0.22)" : "#fdba74"
          );
        }
        ctx.textAlign = "center";
        ctx.fillStyle = titleColor;
        ctx.font = "950 15px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText(ds.show_store_name ? storeName : ds.table_title, x + cardW / 2, y + (ds.show_logo ? 68 : 34));
        ctx.fillStyle = isPremium ? "#ffffff" : "#9a3412";
        ctx.font = "950 24px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText(formatTableLabel(loaded[i].n), x + cardW / 2, y + (ds.show_logo ? 96 : 64));
        ctx.textAlign = "start";
      } else {
        const titleX = x + innerPad + (markSize ? markSize + 8 : 0);
        if (ds.show_logo) {
          const markFill = isPhoto ? "rgba(255,255,255,0.2)" : ds.accent_color || "#111827";
          roundRect(ctx, x + innerPad, y + 12, markSize, markSize, 10, markFill);
          if (tableLogoImg) {
            ctx.save();
            ctx.beginPath();
            roundedClipPath(ctx, x + innerPad, y + 12, markSize, markSize, 10);
            ctx.clip();
            ctx.drawImage(tableLogoImg, x + innerPad, y + 12, markSize, markSize);
            ctx.restore();
          } else {
            ctx.fillStyle = "#ffffff";
            ctx.font = "900 15px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
            ctx.fillText(storeName.trim().slice(0, 1) || "Q", x + innerPad + 9, y + 33);
          }
        }
        ctx.fillStyle = isPhoto ? "#ffffff" : titleColor;
        ctx.font = "950 16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText(ds.show_store_name ? storeName : ds.table_title, titleX, titleY);
        ctx.fillStyle = isPhoto ? "rgba(255,255,255,0.9)" : mutedColor;
        ctx.font = "900 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText(formatTableLabel(loaded[i].n), x + innerPad, y + 62);
      }

      const qrX = x + Math.floor((cardW - qrSize) / 2);
      const qrY = y + (isPremium || isRound ? 118 : labelH + (isPhoto ? 8 : 0));
      roundRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, isRound ? 24 : 16, "#ffffff", isPremium ? "rgba(255,255,255,0.25)" : "#e5e7eb");
      ctx.drawImage(loaded[i].img, qrX, qrY, qrSize, qrSize);

      ctx.fillStyle = mutedColor;
      ctx.font = "850 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(ds.table_description || "QR을 찍고 메뉴를 선택해 주세요.", x + innerPad, y + cardH - (ds.show_target_url ? 32 : 16));
      ctx.fillStyle = isPremium ? "rgba(255,255,255,0.5)" : "#9ca3af";
      ctx.font = "800 10.5px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      if (ds.show_target_url) ctx.fillText(trimMiddle(loaded[i].url, 52), x + innerPad, y + cardH - 14);
    }

    canvases.push(canvas);
  }

  return canvases;
}
