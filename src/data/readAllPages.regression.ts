import assert from 'node:assert/strict'
import { HARVEST_LOAD_SUM_LIMIT, readAllPages } from './SupabaseGrainDataGateway'

// A stand-in for PostgREST: it answers a range request with at most `cap` rows, silently, the way the
// real server does, and reports the exact total only when `withCount` is set.
function server(total: number, cap: number, withCount = true, failAtPage = -1) {
  const table = Array.from({ length: total }, (_, index) => ({ id: index }))
  const requests: Array<[number, number]> = []
  const page = async (from: number, to: number) => {
    requests.push([from, to])
    if (requests.length - 1 === failAtPage) return { data: null, error: { message: 'boom' }, count: null }
    return { data: table.slice(from, Math.min(to + 1, from + cap)), error: null, count: withCount ? total : null }
  }
  return { page, requests }
}
const ids = (data: unknown) => (data as Array<{ id: number }>).map((row) => row.id)
const everyRowOnce = (data: unknown, total: number, message: string) => assert.deepEqual(ids(data), Array.from({ length: total }, (_, index) => index), message)

{
  const { page, requests } = server(2_500, 1_000)
  everyRowOnce((await readAllPages(page)).data, 2_500, 'Past the 1,000-row cap, every row arrives once, in order')
  assert.equal(requests.length, 3, 'Three pages for 2,500 rows')
}
{
  // A server capped below the page size returns 400 of the 1,000 asked for; the next page must start at 400.
  const { page } = server(1_000, 400)
  everyRowOnce((await readAllPages(page)).data, 1_000, 'A cap smaller than the page size still yields every row, none skipped')
}
{
  const { page } = server(2_500, 1_000, false)
  everyRowOnce((await readAllPages(page)).data, 2_500, 'Without a count, a short page is the end and nothing is lost before it')
}
{
  everyRowOnce((await readAllPages(server(999, 1_000).page)).data, 999, 'One short page is the whole table')
  everyRowOnce((await readAllPages(server(0, 1_000).page)).data, 0, 'An empty table is an empty list')
}
{
  // The harvest total stops once it holds more tickets than it can sum, so the repository can say "incomplete".
  const { page, requests } = server(7_000, 1_000)
  const result = await readAllPages(page, HARVEST_LOAD_SUM_LIMIT)
  assert.ok(ids(result.data).length > HARVEST_LOAD_SUM_LIMIT, 'The harvest read holds more than the limit, so it is reported incomplete')
  assert.equal(requests.length, 6, 'It stops reading once past the limit')
}
{
  const { page } = server(2_500, 1_000, true, 1)
  const result = await readAllPages(page)
  assert.deepEqual(result.error, { message: 'boom' }, 'A failed page is a failed read, never a partial list')
  assert.equal(result.data, null)
}

console.log('readAllPages regression: ok')
