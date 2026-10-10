// Dates are kept as YYYY-MM-DD strings and compared in UTC, so timezones never shift a deadline.
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const utc = (s: string) => { const [y,m,d] = s.split('-').map(Number); return Date.UTC(y, m-1, d) }
export const daysUntil = (iso: string) => Math.round((utc(iso) - utc(todayISO())) / 86400000)
export const addDays = (iso: string, n: number) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10) }
export const fmt = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) }
