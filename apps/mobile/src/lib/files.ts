import { Directory, File, Paths } from "expo-file-system";

/** Captures live here until uploaded (the cache dir can be purged by the OS). */
function capturesDir(): Directory {
  const dir = new Directory(Paths.document, "captures");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Moves a fresh camera file into app storage and returns its new URI and size. */
export async function persistCapture(sourceUri: string, id: string, ext: string) {
  const target = new File(capturesDir(), `${id}.${ext}`);
  await new File(sourceUri).move(target);
  return { uri: target.uri, size: target.size };
}

/** SHA-256 (lowercase hex) computed natively on the device, without loading the file into JS. */
export function sha256File(uri: string): Promise<string> {
  return new File(uri).digest("SHA-256");
}

export async function uploadFile(args: {
  fileUri: string;
  url: string;
  headers: Record<string, string>;
  onProgress: (fraction: number) => void;
}): Promise<{ status: number }> {
  const task = new File(args.fileUri).createUploadTask(args.url, {
    httpMethod: "PUT",
    headers: args.headers,
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) args.onProgress(bytesSent / totalBytes);
    },
  });
  const res = await task.uploadAsync();
  return { status: res.status };
}

export function deleteFile(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}
