/** Optional OCR. Runs in the browser only when the user asks; the result is stored separately and flagged as machine-extracted. */
const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js'  // pinned; loaded lazily, never at page load
export async function runOcr(bytes: Uint8Array, mime: string, lang = 'eng'): Promise<{ text: string; confidence: number }> {
  let mod: { default?: { recognize: Function }; recognize?: Function }
  try { mod = await import(/* @vite-ignore */ SRC) } catch { throw new Error('OCR could not be loaded (it needs internet access to jsdelivr.net). You can still type a description or the text manually.') }
  const t = (mod.default ?? mod) as { recognize: (i: Blob, l: string) => Promise<{ data: { text: string; confidence: number } }> }
  try { const { data } = await t.recognize(new Blob([bytes as BlobPart], { type: mime }), lang); return { text: data.text.trim(), confidence: data.confidence } }
  catch (e) { throw new Error('OCR failed: ' + (e instanceof Error ? e.message : String(e))) }
}
