/** Compare validated manifest versions without rounding large numeric identifiers. */
export function comparePluginVersions(left: string, right: string): number {
  const [leftCore = '', leftPre] = left.split(/-(.*)/s)
  const [rightCore = '', rightPre] = right.split(/-(.*)/s)
  const a = leftCore.split('.'),
    b = rightCore.split('.')
  for (let i = 0; i < 3; i++) {
    const difference = BigInt(a[i]!) - BigInt(b[i]!)
    if (difference) return difference > 0n ? 1 : -1
  }
  if (leftPre === rightPre) return 0
  if (leftPre === undefined) return 1
  if (rightPre === undefined) return -1
  const ap = leftPre.split('.'),
    bp = rightPre.split('.')
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i],
      y = bp[i]
    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y)
    if (xn && yn) {
      const difference = BigInt(x) - BigInt(y)
      if (difference) return difference > 0n ? 1 : -1
    } else if (xn !== yn) return xn ? -1 : 1
    else return x > y ? 1 : -1
  }
  return 0
}
