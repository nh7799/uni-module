import type {
  AttachmentRow,
  Blobish,
  DbPort,
  ImageProcessor,
  NewAttachment,
  Parent,
  ProcessedImage,
  StoragePort,
} from "../lib/attachments/types";
export const USER = "aaaaaaaa-0000-0000-0000-000000000001";
let n = 0;
export const uid = () =>
  `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
export const be32 = (v: number) => [
  (v >>> 24) & 255,
  (v >>> 16) & 255,
  (v >>> 8) & 255,
  v & 255,
];
export function png(w: number, h: number, pad = 64, seed = 0): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...be32(w),
    ...be32(h),
    8,
    6,
    0,
    0,
    0,
    ...Array.from({ length: pad }, (_, i) => (i * 7 + seed) & 255),
  ]);
}
export function jpeg(w: number, h: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    4,
    0,
    0,
    0xff,
    0xc0,
    0,
    11,
    8,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    1,
    1,
    0x11,
    0,
    ...new Array(40).fill(1),
  ]);
}
export function webp(w: number, h: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([
    82,
    73,
    70,
    70,
    32,
    0,
    0,
    0,
    87,
    69,
    66,
    80,
    86,
    80,
    56,
    88,
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    (w - 1) & 255,
    ((w - 1) >> 8) & 255,
    0,
    (h - 1) & 255,
    ((h - 1) >> 8) & 255,
    0,
  ]);
  return b;
}
export const file = (
  bytes: Uint8Array,
  name = "photo.png",
  type = "image/png",
) => ({ name, size: bytes.length, type, bytes: async () => bytes });

export class FakeDb implements DbPort {
  rows = new Map<string, AttachmentRow>();
  parents = new Set<string>();
  failNextUpdate: ((patch: Partial<AttachmentRow>) => boolean) | null = null;
  deleteFails = false;
  addParent(p: Parent) {
    this.parents.add(`${p.type}:${p.id}`);
    return p;
  }
  async insert(r: NewAttachment) {
    if (!this.parents.has(`${r.parent_type}:${r.parent_id}`))
      return {
        error: {
          code: "23503",
          message: "attachment parent does not exist or is not yours",
        },
      };
    if (
      [...this.rows.values()].some(
        (x) =>
          x.parent_id === r.parent_id &&
          x.checksum === r.checksum &&
          x.status !== "pending_deletion",
      )
    )
      return { error: { code: "23505", message: "duplicate" } };
    const row = {
      error: null,
      caption: "",
      alt_text: "",
      description: "",
      width: null,
      height: null,
      original_path: null,
      original_bytes: null,
      original_retained: false,
      display_path: null,
      display_mime: null,
      display_bytes: null,
      thumb_path: null,
      thumb_bytes: null,
      optimized: false,
      extracted_text: "",
      extracted_source: null,
      extracted_edited: false,
      ...r,
      kind: r.kind ?? "image",
      original_name: r.original_name ?? null,
    } as AttachmentRow;
    this.rows.set(row.id, row);
    return { row: { ...row } };
  }
  async findByChecksum(p: Parent, c: string) {
    return (
      [...this.rows.values()].find(
        (x) =>
          x.parent_id === p.id &&
          x.parent_type === p.type &&
          x.checksum === c &&
          x.status !== "pending_deletion",
      ) ?? null
    );
  }
  async get(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async update(id: string, patch: Partial<AttachmentRow>) {
    if (this.failNextUpdate?.(patch)) {
      this.failNextUpdate = null;
      return { error: { message: "connection reset" } };
    }
    const r = this.rows.get(id);
    if (!r) return { error: { message: "not found" } };
    Object.assign(r, patch);
    return {};
  }
  async list(p: Parent, all = false) {
    return [...this.rows.values()]
      .filter(
        (x) =>
          x.parent_id === p.id &&
          x.parent_type === p.type &&
          (all || x.status !== "pending_deletion"),
      )
      .sort((a, b) => a.position - b.position)
      .map((x) => ({ ...x }));
  }
  async delete(id: string) {
    if (this.deleteFails) return { error: { message: "db down" } };
    this.rows.delete(id);
    return {};
  }
}
export class FakeStorage implements StoragePort {
  objects = new Map<string, Blobish>();
  uploadFailures = 0;
  failPathPart: string | null = null;
  hideAfterUpload = false;
  removeFails = false;
  signedFails = false;
  uploads: string[] = [];
  async upload(path: string, f: Blobish) {
    this.uploads.push(path);
    if (this.failPathPart && path.includes(this.failPathPart))
      return { error: { message: "storage unavailable" } };
    if (this.uploadFailures > 0) {
      this.uploadFailures--;
      return { error: { message: "timeout" } };
    }
    this.objects.set(path, f);
    return {};
  }
  async download(p: string) {
    return this.objects.get(p)?.bytes ?? null;
  }
  async remove(paths: string[]) {
    if (this.removeFails) return { error: { message: "remove failed" } };
    paths.forEach((p) => this.objects.delete(p));
    return {};
  }
  async exists(p: string, bytes?: number) {
    if (this.hideAfterUpload) return false;
    const o = this.objects.get(p);
    return !!o && (bytes == null || o.bytes.length === bytes);
  }
  async signedUrl(p: string) {
    return this.signedFails || !this.objects.has(p)
      ? null
      : "https://signed/" + p;
  }
}
export class FakeProcessor implements ImageProcessor {
  mode: "ok" | "throw" | "hang" | "noDisplay" = "ok";
  calls = 0;
  async process(
    bytes: Uint8Array,
    info: { width: number; height: number },
    signal: AbortSignal,
  ): Promise<ProcessedImage> {
    this.calls++;
    if (this.mode === "throw") throw new Error("decode error");
    if (this.mode === "hang")
      await new Promise((_, rej) =>
        signal.addEventListener("abort", () => rej(new Error("aborted"))),
      );
    return {
      display:
        this.mode === "noDisplay"
          ? null
          : {
              bytes: bytes.subarray(0, Math.max(8, bytes.length >> 1)),
              mime: "image/webp",
            },
      thumb: { bytes: bytes.subarray(0, 12), mime: "image/webp" },
      width: info.width,
      height: info.height,
      optimized: this.mode !== "noDisplay",
    };
  }
}
