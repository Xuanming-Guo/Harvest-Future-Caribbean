"use client";

import { useQuery } from "@tanstack/react-query";
import { CloudRain } from "lucide-react";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import {
  FARM_FORECAST_DAYS,
  conditionLabel,
  conditionTone,
  cropRiskNote,
  forecastDayLabel,
  nextStorm,
  tempBandLabel,
  type IslandWeather,
} from "@/lib/weather";

const useIslandWeather = (islandId?: string) =>
  useQuery({
    queryKey: ["weather", islandId ?? "default"],
    queryFn: () => api.weather(islandId),
    refetchInterval: 60_000,
  });

/** Every weather panel says where its numbers came from, because none of them were measured. */
function WeatherProvenance() {
  return (
    <p className="muted-copy weather-provenance">
      Synthetic conditions and a deliberately imperfect forecast. Recorded days are synthetic records; forecast days are
      model predictions and can be wrong. No live weather service is used.
    </p>
  );
}

/**
 * Today's conditions, a short outlook, and what they mean for the crop.
 *
 * Three forecast days rather than the five the API returns: a grower plans
 * collection inside a couple of days, and a day-five outlook that is mostly
 * noise would dilute the two days that are worth acting on.
 */
export function FarmWeather({ islandId }: { islandId?: string }) {
  const weather = useIslandWeather(islandId);
  const data = weather.data as IslandWeather | undefined;
  const current = data?.current;
  const forecast = (data?.forecast ?? []).slice(0, FARM_FORECAST_DAYS);

  return (
    <Card className="weather-card" data-testid="farm-weather">
      <SectionTitle title="Weather on your island" detail={current ? `Recorded ${current.date}` : "No reading yet"} />
      {!current ? (
        <EmptyState title="No conditions recorded yet" detail="Today's weather will appear here once the day is recorded." />
      ) : (
        <>
          <div className="weather-today">
            <span className="weather-mark" aria-hidden="true">
              <CloudRain size={22} />
            </span>
            <div>
              <Badge tone={conditionTone(current.condition)}>{conditionLabel(current.condition)}</Badge>
              <b>
                {current.rainMm} mm rain, {current.windKph} km/h wind
              </b>
              <small>Feels {tempBandLabel(current.tempBand)} today.</small>
            </div>
          </div>
          <ul className="weather-forecast">
            {forecast.map((day) => (
              <li key={day.date}>
                <span className="weather-forecast-day">{forecastDayLabel(day.date)}</span>
                <Badge tone={conditionTone(day.condition)}>{conditionLabel(day.condition)}</Badge>
                <span className="weather-forecast-rain">{day.rainMm} mm</span>
                <small>{Math.round(day.confidence * 100)}% confidence</small>
              </li>
            ))}
          </ul>
          <p className="weather-risk">{cropRiskNote(data)}</p>
        </>
      )}
      <WeatherProvenance />
    </Card>
  );
}

/**
 * One row per island a coordinator covers, with today's conditions and the
 * whole published outlook.
 *
 * The Product API answers for one island at a time, and a coordinator's
 * permitted farms are currently all on one, so this renders the single row it
 * can actually justify rather than inventing a region it has no data for. The
 * shape takes more rows without changing.
 */
export function IslandWeatherTable({ islandIds }: { islandIds?: readonly string[] }) {
  const islands = islandIds?.length ? islandIds : [undefined];
  return (
    <Card className="section-gap" data-testid="island-weather-table">
      <SectionTitle title="Island weather" detail="Shared with every farmer and driver" />
      <div className="weather-table-scroll">
        <table className="weather-table">
          <thead>
            <tr>
              <th scope="col">Island</th>
              <th scope="col">Today</th>
              <th scope="col">Rain</th>
              <th scope="col">Wind</th>
              <th scope="col">Next storm forecast</th>
            </tr>
          </thead>
          <tbody>
            {islands.map((islandId, index) => (
              <IslandWeatherRow key={islandId ?? `island-${index}`} islandId={islandId} />
            ))}
          </tbody>
        </table>
      </div>
      <WeatherProvenance />
    </Card>
  );
}

function IslandWeatherRow({ islandId }: { islandId?: string }) {
  const weather = useIslandWeather(islandId);
  const data = weather.data as IslandWeather | undefined;
  const current = data?.current;
  const storm = nextStorm(data?.forecast ?? []);

  return (
    <tr>
      <th scope="row">{data?.islandId ?? islandId ?? "-"}</th>
      <td>{current ? <Badge tone={conditionTone(current.condition)}>{conditionLabel(current.condition)}</Badge> : "-"}</td>
      <td>{current ? `${current.rainMm} mm` : "-"}</td>
      <td>{current ? `${current.windKph} km/h` : "-"}</td>
      <td>
        {storm
          ? `${forecastDayLabel(storm.date)}, ${Math.round(storm.confidence * 100)}% confidence`
          : "None in the outlook"}
      </td>
    </tr>
  );
}
