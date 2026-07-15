export interface ScheduledWeatherObservation { time: string; temperature_2m: number; relative_humidity_2m: number; precipitation: number; rain: number; weather_code: number; wind_speed_10m: number; wind_gusts_10m: number; precipitation_probability?: number | null }

/** Conservative server-side subset of the in-app spray guidance. A scheduled
 * alert fires only for clearly good conditions; uncertainty stays non-good. */
export function scheduledSprayIsGood(value: ScheduledWeatherObservation) {
  return Number.isFinite(value.temperature_2m) && value.temperature_2m <= 85
    && Number.isFinite(value.wind_speed_10m) && value.wind_speed_10m >= 3 && value.wind_speed_10m <= 10
    && Number.isFinite(value.wind_gusts_10m) && value.wind_gusts_10m <= 15
    && value.precipitation === 0 && value.rain === 0
    && (value.precipitation_probability === undefined || value.precipitation_probability === null || value.precipitation_probability < 50)
    && value.weather_code <= 3
}

export function localDateFromForecast(value: ScheduledWeatherObservation) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.time)) throw new Error('Forecast did not provide a local observation time.')
  return value.time.slice(0, 10)
}
