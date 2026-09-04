import type { ApiSchema } from "@harvest/shared";

export type IslandWeather = ApiSchema<"IslandWeather">;
export type WeatherObservation = ApiSchema<"WeatherObservation">;
export type WeatherForecastDay = ApiSchema<"WeatherForecastDay">;
export type WeatherCondition = WeatherObservation["condition"];

/** How many forecast days a workspace shows. Beyond three a grower stops planning and starts guessing. */
export const FARM_FORECAST_DAYS = 3;

/** Rain, in mm, past which a day is worth warning a grower about ahead of time. */
const HEAVY_RAIN_MM = 25;

const CONDITION_LABELS: Record<WeatherCondition, string> = {
  CLEAR: "Clear",
  CLOUD: "Cloudy",
  RAIN: "Rain",
  STORM: "Storm",
};

/** Badge tones already defined in the stylesheet, reused rather than invented. */
const CONDITION_TONES: Record<WeatherCondition, string> = {
  CLEAR: "approved",
  CLOUD: "not-due",
  RAIN: "in-transit",
  STORM: "overdue",
};

export const conditionLabel = (condition: WeatherCondition) => CONDITION_LABELS[condition];
export const conditionTone = (condition: WeatherCondition) => CONDITION_TONES[condition];

export const tempBandLabel = (band: WeatherObservation["tempBand"]) =>
  ({ COOL: "cool", WARM: "warm", HOT: "hot" })[band];

/** A short calendar day, e.g. "Sat 6 Sep", in the island's own time zone. */
export const forecastDayLabel = (date: string) =>
  new Intl.DateTimeFormat("en-LC", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );

/** The first storm in an outlook, which is the only forecast day that changes a plan. */
export const nextStorm = (forecast: readonly WeatherForecastDay[]) =>
  forecast.find((day) => day.condition === "STORM");

/**
 * One line telling a grower what today's weather and the days ahead mean for
 * the crop in the ground.
 *
 * Written as advice about *risk*, never as an instruction, and never as a
 * prediction of yield: the forecast can be wrong, and a farmer standing in the
 * field knows more than this sentence does. The order of the checks is the
 * order of severity, so the most consequential thing is the thing that gets
 * said.
 */
export function cropRiskNote(weather: IslandWeather | undefined): string {
  if (!weather?.current) return "No conditions recorded for this island yet.";
  const storm = nextStorm(weather.forecast);
  const heavyRain = weather.forecast.find((day) => day.rainMm >= HEAVY_RAIN_MM);

  if (storm) {
    return `Storm forecast ${storm.leadDays === 1 ? "tomorrow" : `in ${storm.leadDays} days`}. Ready produce is at most risk: bring collection forward if you can, and expect roads to be slower.`;
  }
  if (weather.current.condition === "STORM") {
    return "Storm today. Expect split and blemished fruit to be refused at the gate, and slower pickups.";
  }
  if (heavyRain) {
    return `Heavy rain forecast ${heavyRain.leadDays === 1 ? "tomorrow" : `in ${heavyRain.leadDays} days`}. Ripening slows in the wet and picked produce spoils faster, so report anything ready before it arrives.`;
  }
  if (weather.current.condition === "RAIN") {
    return "Rain today. Ripening slows and ready produce spoils faster, so an update after the rain is worth more than one written before it.";
  }
  if (weather.current.tempBand === "HOT") {
    return "Hot and dry. Produce already picked dehydrates quickly, so keep it shaded until collection.";
  }
  return "Nothing in the outlook threatens the crop. Report produce as it becomes ready.";
}
