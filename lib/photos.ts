// Camera-roll image -> compressed JPEG data URL for storage in a synced row.
// 1280px longest edge at q0.7 lands around 150-250KB — small enough for the
// row-based sync (see UnitPhoto in lib/types.ts), sharp enough to show a
// damaged frame or a gap.

const MAX_EDGE = 1280;
const QUALITY = 0.7;

export async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", QUALITY);
}
