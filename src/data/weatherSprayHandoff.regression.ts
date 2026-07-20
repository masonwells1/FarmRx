import assert from 'node:assert/strict'
import type { ForecastBundle } from './weather'
import { createWeatherSprayHandoff, parseWeatherSprayHandoff } from './weatherSprayHandoff'

const fieldId = '27020000-0000-4000-8000-000000000005'
const foreignFieldId = '27020000-0000-4000-8000-000000000006'
const now = Date.parse('2027-07-07T18:25:00.000Z')
const bundle = {
  stale: false,
  fetched_at: '2027-07-07T18:20:00.000Z',
  current: {
    time: '2027-07-07T13:20',
    temperature_f: 74,
    relative_humidity: 52,
    precipitation_in: 0,
    precipitation_probability: null,
    wind_speed_mph: 8,
    wind_direction_degrees: 225,
    wind_gusts_mph: 10,
    cloud_cover: 30,
  },
} satisfies Pick<ForecastBundle, 'current' | 'fetched_at' | 'stale'>

const handoff = createWeatherSprayHandoff(fieldId, bundle, now)
assert(handoff, 'An actionably fresh forecast should create a handoff.')
assert.equal(handoff.windDirection, 'SW', '225 degrees must map to SW before the handoff leaves Weather.')
assert.deepEqual(parseWeatherSprayHandoff(handoff, [fieldId], now), {
  ...handoff,
  applicationDate: '2027-07-07',
  applicationTime: '13:20',
}, 'A valid handoff must preserve the field and exact field-local sample date/time and weather values.')

assert.equal(parseWeatherSprayHandoff(handoff, [foreignFieldId], now), null, 'A handoff for a field outside the current farm workspace must fail closed.')
assert.equal(createWeatherSprayHandoff(fieldId, { ...bundle, stale: true }, now), null, 'A stale forecast must not create a handoff action.')
assert.equal(parseWeatherSprayHandoff({ ...handoff, fetchedAt: '2027-07-07T16:00:00.000Z' }, [fieldId], now), null, 'A handoff older than the spray freshness ceiling must be rejected at Inventory.')
assert.equal(parseWeatherSprayHandoff({ ...handoff, windDirection: 'SSW' }, [fieldId], now), null, 'An unsupported direction must fail closed.')
assert.equal(parseWeatherSprayHandoff({ ...handoff, relativeHumidityPct: 120 }, [fieldId], now), null, 'Malformed weather values must fail closed.')
assert.equal(parseWeatherSprayHandoff({ ...handoff, surprise: 'unsafe' }, [fieldId], now), null, 'Unexpected state fields must fail closed.')

console.log('Weather to spray handoff regressions passed.')
