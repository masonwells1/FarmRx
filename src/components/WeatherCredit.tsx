/** Open-Meteo's free API is CC BY 4.0: their licence asks for this link next to anywhere their weather data shows.
 * Same style as the place-search credit on the Weather screen: 18px text and 48px link tap targets. */
export function WeatherCredit() {
  return <p className="town-credit">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> <span className="credit-keep">(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>).</span></p>
}
