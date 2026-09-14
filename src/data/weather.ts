export interface WeatherSample {
  time: string
  temperature_f: number
  relative_humidity: number
  precipitation_in: number
  precipitation_probability: number | null
  wind_speed_mph: number
  wind_direction_degrees: number
  wind_gusts_mph: number
  cloud_cover: number
}

export interface CurrentConditions extends WeatherSample {}
export interface HourlyForecast extends WeatherSample {}

export interface DailyForecast {
  date: string
  precipitation_sum_in: number
  precipitation_probability_max: number | null
  temperature_max_f: number
  temperature_min_f: number
  sunrise: string | null
  sunset: string | null
}

export interface ForecastBundle {
  current: CurrentConditions
  hourly: HourlyForecast[]
  daily: DailyForecast[]
  fetched_at: string
  /** The field's offset from UTC in seconds as the provider reported it at fetch time (Open-Meteo `utc_offset_seconds`), so the
   * field's wall clock at any later instant can be recovered from that instant alone. Absent from forecasts saved before it was
   * recorded; a reader that needs the field's clock now must skip those. */
  utc_offset_seconds?: number
  /** The field's IANA time zone as the provider reported it (Open-Meteo `timezone`), so the field's wall clock at a later instant
   * follows the zone's own rules, including a daylight-saving change inside the cache's lifetime; the offset above is the fallback
   * when the zone name cannot be resolved. Absent from forecasts saved before it was recorded. */
  timezone?: string
  /** True only when an older cache is shown because the live request could not finish. */
  stale: boolean
}

export interface DailyHistory {
  date: string
  temperature_max_f: number
  temperature_min_f: number
}

export interface DailyHistoryBundle {
  daily: DailyHistory[]
  fetched_at: string
  /** True only when a previously saved history range is shown after a failed refresh. */
  stale: boolean
}

export type SprayLevel = 'good' | 'caution' | 'poor'
export interface SprayVerdict { level: SprayLevel; reasons: string[] }
export interface SprayContext {
  now: string
  hourly: WeatherSample[]
  sunrise: string | null
  sunset: string | null
  /** Product-specific callers may opt into the stricter inversion result. */
  inversionDriftProne?: boolean
}
export interface SprayWindow {
  start: string
  end: string
  hours: number
  label: string
}
