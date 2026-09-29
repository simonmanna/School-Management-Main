/**
 * Multipart limits for every upload route (audit 2026-09-29 A04).
 *
 * The patched parser (multer >= 2.3.0) fixes the field-name/index denial of
 * service; these bounds are the second wall. An upload is one file plus a few
 * short text fields, so anything beyond that is refused before it is buffered.
 */
export const UPLOAD_LIMITS = {
  fileSize: 25 * 1024 * 1024,
  files: 1,
  fields: 20,
  fieldNameSize: 100,
  fieldSize: 64 * 1024,
  parts: 21,
  headerPairs: 50,
} as const;

export const UPLOAD_OPTIONS = { limits: UPLOAD_LIMITS };
