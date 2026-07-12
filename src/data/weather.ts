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
