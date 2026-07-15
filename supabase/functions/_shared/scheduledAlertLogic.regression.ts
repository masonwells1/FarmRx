import { localDateFromForecast, scheduledSprayIsGood, type ScheduledWeatherObservation } from './scheduledAlertLogic'
const base: ScheduledWeatherObservation = { time: '2026-07-15T09:15', temperature_2m: 74, relative_humidity_2m: 60, precipitation: 0, rain: 0, weather_code: 1, wind_speed_10m: 6, wind_gusts_10m: 9, precipitation_probability: 10 }
if (!scheduledSprayIsGood(base)) throw new Error('A clearly good scheduled spray observation did not qualify.')
for (const unsafe of [{ wind_speed_10m: 2 }, { wind_speed_10m: 12 }, { wind_gusts_10m: 20 }, { precipitation: 0.01 }, { precipitation_probability: 70 }, { temperature_2m: 90 }, { weather_code: 61 }]) if (scheduledSprayIsGood({ ...base, ...unsafe })) throw new Error(`Unsafe scheduled spray observation qualified: ${JSON.stringify(unsafe)}`)
if (localDateFromForecast(base) !== '2026-07-15') throw new Error('Forecast-local date was not preserved.')
console.log('Scheduled alert logic regression passed (3 groups).')
