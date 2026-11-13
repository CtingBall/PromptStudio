// 2026-11-13 (full: + time)
export function fmtDate(ms: number, full = false): string {
  if (!ms) return ''
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0')
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return full ? `${day} ${p(d.getHours())}:${p(d.getMinutes())}` : day
}
// bucket label for grouping the set list by date
export function dateBucket(ms: number, now = Date.now()): string {
  const d = new Date(ms), t = new Date(now)
  const day0 = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()
  if (ms >= day0) return '今天'
  if (ms >= day0 - 86400000) return '昨天'
  if (ms >= day0 - 6 * 86400000) return '最近 7 天'
  if (d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth()) return '本月'
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}
