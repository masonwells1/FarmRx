/** PostgreSQL numeric-style decimal rounding: ties round away from zero. */
function plainDecimal(value: number) {
  const [coefficient, exponentPart] = Math.abs(value).toString().toLowerCase().split('e')
  const exponent = Number(exponentPart ?? '0')
  const [whole, fraction = ''] = coefficient.split('.')
  const digits = `${whole}${fraction}`
  const point = whole.length + exponent
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${digits}${'0'.repeat(point - digits.length)}`
  return `${digits.slice(0, point)}.${digits.slice(point)}`
}

export function roundDecimalHalfUp(value: number, places: number): number
export function roundDecimalHalfUp(value: null, places: number): null
export function roundDecimalHalfUp(value: number | null, places: number): number | null
export function roundDecimalHalfUp(value: number | null, places: number): number | null {
  if (value === null || !Number.isFinite(value)) return value
  const [whole, fraction = ''] = plainDecimal(value).split('.')
  const keptFraction = `${fraction}${'0'.repeat(places)}`.slice(0, places)
  let digits = `${whole}${keptFraction}`.replace(/^0+(?=\d)/, '') || '0'
  if ((fraction[places] ?? '0') >= '5') {
    const next = [...digits]
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (next[index] === '9') next[index] = '0'
      else { next[index] = String(Number(next[index]) + 1); break }
      if (index === 0) next.unshift('1')
    }
    digits = next.join('')
  }
  const padded = digits.padStart(places + 1, '0')
  const decimal = places ? `${padded.slice(0, -places)}.${padded.slice(-places)}` : padded
  return Number(`${value < 0 ? '-' : ''}${decimal}`)
}
