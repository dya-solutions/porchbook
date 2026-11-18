import { uploadPlace } from "@/lib/porch/storage-settings";

/**
 * Send a file from the phone straight to storage: Cloudflare R2 when it's switched on (a signed link),
 * otherwise Vercel Blob as before. Returns the file's public link.
 */
export async function uploadFile(
  pathname: string,
  file: File,
  opts: { handleUploadUrl: string; contentType: string; onProgress?: (percent: number) => void },
): Promise<string> {
  const place = await uploadPlace({ data: { pathname, contentType: opts.contentType } }).catch(() => ({ mode: "blob" as const }));
  if (place.mode === "r2") {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", place.putUrl);
      xhr.setRequestHeader("content-type", opts.contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}). Try again.`)));
      xhr.onerror = () => reject(new Error("Upload failed. Check the connection and try again."));
      xhr.send(file);
    });
    return place.url;
  }
  const { upload } = await import("@vercel/blob/client");
  const stored = await upload(pathname, file, {
    access: "public",
    handleUploadUrl: opts.handleUploadUrl,
    contentType: opts.contentType,
    multipart: file.size > 8 * 1024 * 1024,
    onUploadProgress: ({ percentage }) => opts.onProgress?.(Math.round(percentage)),
  });
  return stored.url;
}
