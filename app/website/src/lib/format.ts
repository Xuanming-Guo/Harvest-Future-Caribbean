export const compactId = (value?: string) => (value ? `${value.slice(0, 8)}...` : "-");

export const formatDate = (value?: string, includeTime = true) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-LC", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" } : {}),
    timeZone: "America/St_Lucia",
  }).format(new Date(value));
};

export const formatClock = (value: number | string) =>
  new Intl.DateTimeFormat("en-LC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/St_Lucia",
  }).format(new Date(value));

export const formatPercent = (value: number) =>
  new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 }).format(value);

export const titleCase = (value: string) =>
  value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/** A crop name as it reads inside a sentence, whatever case the API sent. */
export const cropName = (value: string) => value.toLowerCase().replaceAll("_", " ");

/** "1 crop" and "3 crops", so a count never reads as machine output. */
export const plural = (count: number, singular: string, many = `${singular}s`) =>
  `${count} ${count === 1 ? singular : many}`;

/** Weights farmers speak out loud: no trailing zeros, always the unit. */
export const formatKg = (value: number) =>
  `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value)} kg`;

const twoDigits = (value: number) => String(value).padStart(2, "0");

export function dateInputOffset(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${twoDigits(value.getMonth() + 1)}-${twoDigits(value.getDate())}`;
}

export function dateTimeInputOffset(days: number, hour = 15) {
  return `${dateInputOffset(days)}T${twoDigits(hour)}:00`;
}
