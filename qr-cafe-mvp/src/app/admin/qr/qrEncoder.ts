const QR_VERSION_DATA = [
  { version: 1, size: 21, dataCodewords: 19, eccCodewords: 7, align: [] as number[] },
  { version: 2, size: 25, dataCodewords: 34, eccCodewords: 10, align: [6, 18] },
  { version: 3, size: 29, dataCodewords: 55, eccCodewords: 15, align: [6, 22] },
  { version: 4, size: 33, dataCodewords: 80, eccCodewords: 20, align: [6, 26] },
  { version: 5, size: 37, dataCodewords: 108, eccCodewords: 26, align: [6, 30] },
];

const FORMAT_BITS_L_MASK_0 = "111011111000100";

function getQrVersion(text: string) {
  const bytes = new TextEncoder().encode(text);
  const neededBits = 4 + 8 + bytes.length * 8;
  const picked = QR_VERSION_DATA.find((v) => v.dataCodewords * 8 >= neededBits + 4);
  if (!picked) throw new Error("QR URL이 너무 깁니다. 짧은 도메인 또는 QR ID 방식이 필요합니다.");
  return { ...picked, bytes };
}

function gfMul(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    if (((y >>> i) & 1) !== 0) z ^= x;
  }
  return z & 0xff;
}

function reedSolomonGenerator(degree: number) {
  let result = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = new Array(result.length + 1).fill(0);
    for (let j = 0; j < result.length; j++) {
      next[j] ^= gfMul(result[j], root);
      next[j + 1] ^= result[j];
    }
    result = next;
    root = gfMul(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], degree: number) {
  const generator = reedSolomonGenerator(degree);
  const result = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= gfMul(generator[i], factor);
  }
  return result;
}

function appendBits(out: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
}

function bitsToCodewords(bits: number[]) {
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
    out.push(b);
  }
  return out;
}

function createReserved(size: number) {
  return Array.from({ length: size }, () => Array(size).fill(false));
}

function createModules(size: number) {
  return Array.from({ length: size }, () => Array(size).fill(false));
}

function setModule(modules: boolean[][], reserved: boolean[][], x: number, y: number, dark: boolean, reserve = true) {
  if (x < 0 || y < 0 || y >= modules.length || x >= modules.length) return;
  modules[y][x] = dark;
  if (reserve) reserved[y][x] = true;
}

function drawFinder(modules: boolean[][], reserved: boolean[][], x: number, y: number) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setModule(modules, reserved, xx, yy, dark);
    }
  }
}

function drawAlignment(modules: boolean[][], reserved: boolean[][], cx: number, cy: number) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
      setModule(modules, reserved, cx + dx, cy + dy, dark);
    }
  }
}

function drawFunctionPatterns(modules: boolean[][], reserved: boolean[][], version: number, align: number[]) {
  const size = modules.length;
  drawFinder(modules, reserved, 0, 0);
  drawFinder(modules, reserved, size - 7, 0);
  drawFinder(modules, reserved, 0, size - 7);

  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setModule(modules, reserved, i, 6, dark);
    setModule(modules, reserved, 6, i, dark);
  }

  if (version > 1) {
    for (const y of align) {
      for (const x of align) {
        if ((x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6)) continue;
        drawAlignment(modules, reserved, x, y);
      }
    }
  }

  setModule(modules, reserved, 8, size - 8, true);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
}

function drawFormatBits(modules: boolean[][], reserved: boolean[][]) {
  const size = modules.length;
  const bits = FORMAT_BITS_L_MASK_0.split("").map((b) => b === "1");
  const pos1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  const pos2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  pos1.forEach(([x, y], i) => setModule(modules, reserved, x, y, bits[i]));
  pos2.forEach(([x, y], i) => setModule(modules, reserved, x, y, bits[i]));
}

function createQrModules(text: string) {
  const { version, size, dataCodewords, eccCodewords, align, bytes } = getQrVersion(text);
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const b of bytes) appendBits(bits, b, 8);
  appendBits(bits, 0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data = bitsToCodewords(bits);
  for (let pad = 0xec; data.length < dataCodewords; pad ^= 0xec ^ 0x11) data.push(pad);
  const codewords = [...data, ...reedSolomonRemainder(data, eccCodewords)];
  const allBits: number[] = [];
  for (const cw of codewords) appendBits(allBits, cw, 8);

  const modules = createModules(size);
  const reserved = createReserved(size);
  drawFunctionPatterns(modules, reserved, version, align);

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let dx = 0; dx < 2; dx++) {
        const x = right - dx;
        if (reserved[y][x]) continue;
        const raw = bitIndex < allBits.length ? allBits[bitIndex++] === 1 : false;
        modules[y][x] = raw !== ((x + y) % 2 === 0);
      }
    }
    upward = !upward;
  }

  drawFormatBits(modules, reserved);
  return modules;
}

export function createQrDataUrl(text: string, pixelSize = 720) {
  const modules = createQrModules(text);
  const moduleCount = modules.length;
  const quiet = 4;
  const canvas = document.createElement("canvas");
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("QR 캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pixelSize, pixelSize);
  const cell = Math.floor(pixelSize / (moduleCount + quiet * 2));
  const offset = Math.floor((pixelSize - cell * (moduleCount + quiet * 2)) / 2) + quiet * cell;
  ctx.fillStyle = "#111827";
  for (let y = 0; y < moduleCount; y++) {
    for (let x = 0; x < moduleCount; x++) {
      if (modules[y][x]) ctx.fillRect(offset + x * cell, offset + y * cell, cell, cell);
    }
  }
  return canvas.toDataURL("image/png");
}
