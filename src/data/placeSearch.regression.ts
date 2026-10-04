import assert from 'node:assert/strict'
import { createWeatherService, parsePlaceMatches } from './weatherService'

const sample = { results: [
  { name: 'Tuscola', latitude: 39.7992, longitude: -88.2831, admin1: 'Illinois', admin2: 'Douglas' },
  { name: 'Champaign', latitude: 40.11642, longitude: -88.24338, admin1: 'Illinois', admin2: 'Champaign' },
  { name: 'Broken', latitude: 'x', longitude: -88 },
  { name: '', latitude: 40, longitude: -88 },
  { name: 'Off map', latitude: 120, longitude: -88 },
] }
const matches = parsePlaceMatches(sample)
assert.deepEqual(matches.map((match) => `${match.name}|${match.region}`), ['Tuscola|Douglas County, Illinois', 'Champaign|Illinois'], 'Only usable rows survive, and a county named like its town is not repeated.')
assert.deepEqual(parsePlaceMatches({}), [], 'No results means no matches.')
assert.deepEqual(parsePlaceMatches(null), [], 'A malformed reply means no matches.')

const calls: string[] = []
const service = createWeatherService({ fetch: (async (url: string) => { calls.push(url); return new Response(JSON.stringify(sample), { status: 200 }) }) as unknown as typeof fetch, clock: () => new Date('2027-05-01T12:00:00Z'), storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } as never })
const found = await service.searchPlaces('  61953 ')
assert.equal(found.length, 2)
assert.ok(calls[0]!.startsWith('https://geocoding-api.open-meteo.com/v1/search?') && calls[0]!.includes('name=61953') && calls[0]!.includes('countryCode=US'), 'Search goes only to the Open-Meteo geocoder, US only, trimmed.')
await assert.rejects(() => service.searchPlaces('x'), /town name or a 5-digit ZIP/, 'A one-letter search is refused before any network call.')
assert.equal(calls.length, 1)
console.log('Place search regression passed')
