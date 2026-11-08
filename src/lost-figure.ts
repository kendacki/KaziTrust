const KEY = "kazitrust.lost.figure.v1";
const FALLBACK = "/lost.png";

let memory: string | null = null;

export function readCachedLostFigure(): string {
  if (memory) return memory;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved?.startsWith("data:image/")) {
      memory = saved;
      return saved;
    }
  } catch {
    /* Storage blocked. Network or in-memory cache still works while online. */
  }
  return FALLBACK;
}

export async function warmLostFigure(): Promise<string> {
  const current = readCachedLostFigure();
  if (current.startsWith("data:image/")) return current;
  try {
    const response = await fetch(FALLBACK, { cache: "force-cache" });
    if (!response.ok) return current;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size < 1_000 || blob.size > 2_000_000) return current;
    const dataUrl = await blobToDataUrl(blob);
    memory = dataUrl;
    try {
      localStorage.setItem(KEY, dataUrl);
    } catch {
      /* Keep the in-memory copy for this session even if storage is full. */
    }
    return dataUrl;
  } catch {
    return current;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read the figure."));
    reader.readAsDataURL(blob);
  });
}
