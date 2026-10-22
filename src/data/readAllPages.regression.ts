import assert from 'node:assert/strict'
import { HARVEST_LOAD_SUM_LIMIT, READ_PAGE_SIZE, readAllPages } from './SupabaseGrainDataGateway'

// A stand-in for PostgREST answering a keyset page (`order=id`, `id=gt.<after>`, `limit`): at most `cap`
// rows, silently, the way the real server does. Its exact count is, like the real one, the number of rows
// the request's filter matches -- the rows after the cursor, not the whole table -- and only when
// `withCount` is set.
// `between` runs after each page, so a test can change the table mid-read the way another device would.
const id = (index: number) => `row-${String(index).padStart(6, '0')}`
function server(total: number, cap: number, options: { withCount?: boolean; failAtPage?: number; between?: (table: string[], pageIndex: number) => void } = {}) {
  const table = Array.from({ length: total }, (_, index) => id(index))
  let pages = 0
  const page = async (afterId: string | null) => {
    const pageIndex = pages++
    if (pageIndex === options.failAtPage) return { data: null, error: { message: 'boom' }, count: null }
    const matching = [...table].sort().filter((value) => afterId === null || value > afterId)
    const rows = matching.slice(0, Math.min(cap, READ_PAGE_SIZE)).map((value) => ({ id: value }))
    const count = options.withCount === false ? null : matching.length
    options.between?.(table, pageIndex)
    return { data: rows, error: null, count }
  }
  return { page, table, pages: () => pages }
}
const ids = (data: unknown) => (data as Array<{ id: string }>).map((row) => row.id)
const everyRowOnce = (data: unknown, expected: string[], message: string) => assert.deepEqual(ids(data), [...expected].sort(), message)
const range = (total: number) => Array.from({ length: total }, (_, index) => id(index))

{
  const fake = server(2_500, 1_000)
  everyRowOnce((await readAllPages(fake.page)).data, range(2_500), 'Past the 1,000-row cap, every row arrives once')
  assert.equal(fake.pages(), 3, 'Three pages for 2,500 rows')
}
{
  // A server capped below the page size returns 400 of the 1,000 asked for; the count of rows still after the
  // cursor (1,000, then 600, then 200) keeps the read going until the page that holds all of them.
  const capped = server(1_000, 400)
  everyRowOnce((await readAllPages(capped.page)).data, range(1_000), 'A cap smaller than the page size still yields every row')
  assert.equal(capped.pages(), 3, 'Three 400-row pages read 1,000 rows')
  everyRowOnce((await readAllPages(server(2_500, 400).page)).data, range(2_500), 'A low cap over several pages still yields every row')
  // The harvest total under a low cap still reads past its limit, so a partial figure is never called complete.
  assert.ok(ids((await readAllPages(server(7_000, 400).page, HARVEST_LOAD_SUM_LIMIT)).data).length > HARVEST_LOAD_SUM_LIMIT, 'Under a low cap the harvest read still passes its limit')
}
{
  everyRowOnce((await readAllPages(server(2_500, 1_000, { withCount: false }).page)).data, range(2_500), 'Without a count, a short page is the end and nothing is lost before it')
  everyRowOnce((await readAllPages(server(999, 1_000).page)).data, range(999), 'One short page is the whole table')
  everyRowOnce((await readAllPages(server(0, 1_000).page)).data, [], 'An empty table is an empty list')
}
{
  // Another device writes a row that sorts before the cursor between pages, and deletes one already read.
  // Paging by position would now re-read a row and skip another; by id, every row that existed for the
  // whole read is counted exactly once.
  const fake = server(2_500, 1_000, { between: (table, pageIndex) => { if (pageIndex === 0) { table.push('row-000000a'); table.splice(table.indexOf(id(10)), 1) } } })
  const got = ids((await readAllPages(fake.page)).data)
  assert.equal(new Set(got).size, got.length, 'No row is counted twice when the table changes mid-read')
  for (const persistent of range(2_500).filter((value) => value !== id(10))) assert.ok(got.includes(persistent), `${persistent}, present for the whole read, was not skipped`)
}
{
  // A row written after the cursor between pages is simply included.
  const fake = server(1_500, 1_000, { between: (table, pageIndex) => { if (pageIndex === 0) table.push('row-999999') } })
  const got = ids((await readAllPages(fake.page)).data)
  assert.equal(new Set(got).size, got.length, 'No duplicate when a later row is added mid-read')
  assert.ok(got.includes('row-999999') && range(1_500).every((value) => got.includes(value)), 'Every row arrives, the new one too')
}
{
  // The harvest total stops once it holds more tickets than it can sum, so the repository can say "incomplete".
  const fake = server(7_000, 1_000)
  assert.ok(ids((await readAllPages(fake.page, HARVEST_LOAD_SUM_LIMIT)).data).length > HARVEST_LOAD_SUM_LIMIT, 'The harvest read holds more than the limit, so it is reported incomplete')
  assert.equal(fake.pages(), 6, 'It stops reading once past the limit')
}
{
  const result = await readAllPages(server(2_500, 1_000, { failAtPage: 1 }).page)
  assert.deepEqual(result.error, { message: 'boom' }, 'A failed page is a failed read, never a partial list')
  assert.equal(result.data, null)
}

console.log('readAllPages regression: ok')
