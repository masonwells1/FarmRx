import { parseScheduledWeatherResponse, scheduledSprayIsGood } from './scheduledAlertLogic'

const now = new Date('2026-07-15T14:15:00.000Z')
const times = ['2026-07-15T14:00','2026-07-15T15:00','2026-07-15T16:00','2026-07-15T17:00','2026-07-15T18:00']
const repeat = (value: number) => times.map(() => value)
const baseBody = () => ({
  utc_offset_seconds: 0,
  current: { time:'2026-07-15T14:15',temperature_2m:74,relative_humidity_2m:60,precipitation:0,rain:0,weather_code:1,wind_speed_10m:6,wind_gusts_10m:9 },
  hourly: {
    time:[...times],temperature_2m:repeat(74),relative_humidity_2m:repeat(60),precipitation:repeat(0),rain:repeat(0),
    weather_code:repeat(1),wind_speed_10m:repeat(6),wind_gusts_10m:repeat(9),precipitation_probability:repeat(10),
  },
})
const expectClosed = (label: string, mutate: (body: ReturnType<typeof baseBody>) => unknown) => {
  const body = baseBody()
  let closed = false
  try { closed = !scheduledSprayIsGood(parseScheduledWeatherResponse(mutate(body), now)) } catch { closed = true }
  if (!closed) throw new Error(`${label} weather did not fail closed.`)
}

if (!scheduledSprayIsGood(parseScheduledWeatherResponse(baseBody(), now))) throw new Error('A complete, fresh, clearly good five-hour forecast did not qualify.')
expectClosed('missing precipitation probability', (body) => { delete (body.hourly as Partial<typeof body.hourly>).precipitation_probability; return body })
expectClosed('null precipitation probability', (body) => { (body.hourly.precipitation_probability as Array<number | null>)[0]=null; return body })
expectClosed('stale observation', (body) => { body.current.time='2026-07-15T12:00'; body.hourly.time=['2026-07-15T12:00','2026-07-15T13:00','2026-07-15T14:00','2026-07-15T15:00','2026-07-15T16:00']; return body })
expectClosed('future observation', (body) => { body.current.time='2026-07-15T14:30'; return body })
expectClosed('malformed HTTP-200 body', () => ({ current:{ time:'2026-07-15T14:15' }, hourly:'not-an-object' }))
expectClosed('missing hourly array', (body) => { delete (body.hourly as Partial<typeof body.hourly>).wind_gusts_10m; return body })
expectClosed('misaligned hourly arrays', (body) => { body.hourly.rain.pop(); return body })
expectClosed('non-consecutive hourly times', (body) => { body.hourly.time[3]='2026-07-15T18:00'; return body })
expectClosed('freezing current conditions', (body) => { body.current.temperature_2m=32; return body })
expectClosed('extreme-cold forecast conditions', (body) => { body.hourly.temperature_2m[2]=20; return body })
expectClosed('current rain', (body) => { body.current.rain=0.01; return body })
expectClosed('imminent rain', (body) => { body.hourly.precipitation[1]=0.01; return body })
expectClosed('imminent rain probability', (body) => { body.hourly.precipitation_probability[1]=40; return body })
expectClosed('unsafe current wind', (body) => { body.current.wind_speed_10m=11; return body })
expectClosed('unsafe future gust', (body) => { body.hourly.wind_gusts_10m[4]=16; return body })
expectClosed('unsafe heat', (body) => { body.hourly.temperature_2m[3]=86; return body })
expectClosed('unsafe weather code', (body) => { body.hourly.weather_code[2]=61; return body })
expectClosed('non-finite value', (body) => { body.hourly.wind_speed_10m[2]=Number.NaN; return body })
expectClosed('negative current gust', (body) => { body.current.wind_gusts_10m=-1; return body })
expectClosed('negative precipitation probability', (body) => { body.hourly.precipitation_probability[1]=-1; return body })
expectClosed('probability above 100', (body) => { body.hourly.precipitation_probability[1]=101; return body })
expectClosed('humidity above 100', (body) => { body.current.relative_humidity_2m=101; return body })
expectClosed('negative rain', (body) => { body.hourly.rain[1]=-0.01; return body })
expectClosed('fractional weather code', (body) => { body.hourly.weather_code[1]=1.5; return body })
expectClosed('negative wind', (body) => { body.hourly.wind_speed_10m[1]=-1; return body })
expectClosed('invalid calendar time', (body) => { body.current.time='2026-02-30T14:15'; return body })
expectClosed('impossible UTC offset', (body) => { body.utc_offset_seconds=86_400; return body })
console.log('Scheduled weather fail-closed regression passed (28 cases).')
