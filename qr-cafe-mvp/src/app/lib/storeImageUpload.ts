const SVG_MIME_TYPE = "image/svg+xml";

function isSvgFile(file: File) {
  return file.type.toLowerCase() === SVG_MIME_TYPE || file.name.toLowerCase().endsWith(".svg");
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("SVG 파일을 이미지로 읽을 수 없습니다."));
    image.src = url;
  });
}

/**
 * Public storage buckets commonly reject SVG MIME types. Rasterize SVG logos in
 * the browser so they can be uploaded safely as transparent PNG images instead.
 */
export async function prepareStoreImage(file: File) {
  if (!isSvgFile(file)) return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const sourceWidth = image.naturalWidth || 1024;
    const sourceHeight = image.naturalHeight || 1024;
    const scale = Math.min(1, 2048 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("SVG 변환을 위한 브라우저 기능을 사용할 수 없습니다.");
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("SVG 파일을 PNG로 변환하지 못했습니다.")),
        "image/png",
      );
    });
    const baseName = file.name.replace(/\.svg$/i, "") || "logo";
    return new File([blob], `${baseName}.png`, { type: "image/png", lastModified: file.lastModified });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
