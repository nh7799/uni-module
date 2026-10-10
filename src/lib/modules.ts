/** Pure module-management logic (no UI, no database) so it can be unit tested. */
export type Award = 'IT' | 'CS' | 'CS-AI' | 'CS-CSN' | 'CS-SE'
export const AWARDS: [Award, string][] = [['CS', 'BSc Computer Science'], ['CS-AI', 'Computer Science (Artificial Intelligence)'], ['CS-CSN', 'Computer Science (Cyber Security and Networks)'], ['CS-SE', 'Computer Science (Software Engineering)'], ['IT', 'BSc Information Technology']]
export interface CatalogueModule { code: string; title: string; level: number; credits: number; semester: string; test: number; exam: number; coursework: number; practical: number; awards: Partial<Record<Award, 'compulsory' | 'optional'>>; variant: boolean; passfail: boolean }
export const PASS_MARK = 40
export const semesterLabel = (s: string) => s === 'AB' ? 'Semesters A + B (year-long)' : s === 'A or B' ? 'Semester A or B' : `Semester ${s}`

export interface Assessment { id: string; title: string; weight: number | null; mark: number | null; due: string | null }
export const num = (v: unknown): number | null => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
export const validMark = (n: number | null) => n === null || (n >= 0 && n <= 100)

export interface Standing {
  banked: number                 // marks already earned, out of 100 for the whole module
  markedWeight: number           // % of the module that has been marked
  assignedWeight: number         // % of the module that has an assessment defined
  unassigned: number             // % of the module with no assessment defined yet
  averageSoFar: number | null    // weighted average of the marked parts only
  remainingWeight: number        // % still to be marked (including unassigned)
  neededAverage: number | null   // average needed on the remaining % to reach the target (null if nothing remains)
  achievable: boolean | null
  final: number | null           // final module mark, only when 100% is marked
  passed: boolean | null
}
export function standing(items: Pick<Assessment, 'weight' | 'mark'>[], target = PASS_MARK): Standing {
  let banked = 0, marked = 0, assigned = 0
  for (const a of items) { const w = a.weight ?? 0; if (w <= 0) continue; assigned += w; if (a.mark !== null && a.mark !== undefined) { banked += w * a.mark / 100; marked += w } }
  const r = (n: number) => Math.round(n * 100) / 100
  const remaining = Math.max(0, 100 - marked); const complete = marked >= 100 - 1e-9
  const needed = complete ? null : r(((target - banked) / remaining) * 100)
  return { banked: r(banked), markedWeight: r(marked), assignedWeight: r(assigned), unassigned: r(Math.max(0, 100 - assigned)), averageSoFar: marked > 0 ? r(banked / marked * 100) : null, remainingWeight: r(remaining),
    neededAverage: needed, achievable: complete ? banked >= target : needed !== null ? needed <= 100 : null, final: complete ? r(banked) : null, passed: complete ? banked >= PASS_MARK : null }
}
/** Which assessment components the programme specification lists for a module. */
export function specComponents(m: Pick<CatalogueModule, 'test' | 'exam' | 'coursework' | 'practical'>): { title: string; weight: number }[] {
  return ([['Test', m.test], ['Examination', m.exam], ['Coursework', m.coursework], ['Practical', m.practical]] as [string, number][]).filter(([, w]) => w > 0).map(([title, weight]) => ({ title, weight }))
}
export function creditSummary(mods: { level: number; credits: number; status: string; passed: boolean | null }[]) {
  const by: Record<number, { planned: number; passed: number }> = {}
  for (const m of mods) { const l = (by[m.level] ??= { planned: 0, passed: 0 }); l.planned += m.credits; if (m.passed) l.passed += m.credits }
  return by
}
export const forAward = (cat: CatalogueModule[], award: Award, level: number, showVariants = false) => cat.filter(m => m.level === level && m.awards[award] && (showVariants || !m.variant))
