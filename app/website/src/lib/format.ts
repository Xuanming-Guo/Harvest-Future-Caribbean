export const compactId = (value?: string) => (value ? `${value.slice(0, 8)}...` : "-");

export const formatDate = (value?: string, includeTime = true) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-LC", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" } : {}),
    timeZone: "America/St_Lucia",
  }).format(new Date(value));
};

export const formatPercent = (value: number) =>
  new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 }).format(value);

export const titleCase = (value: string) =>
  value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const twoDigits = (value: number) => String(value).padStart(2, "0");

export function dateInputOffset(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${twoDigits(value.getMonth() + 1)}-${twoDigits(value.getDate())}`;
}

export function dateTimeInputOffset(days: number, hour = 15) {
  return `${dateInputOffset(days)}T${twoDigits(hour)}:00`;
}
