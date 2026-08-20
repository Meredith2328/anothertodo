const COMPATIBLE_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/u;

export const parseCompatibleDateTime = (value: string): Date | undefined => {
  if (!COMPATIBLE_DATE_TIME.test(value)) return undefined;
  const input = /:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/u.test(value) ? value : `${value}:00`;
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date : undefined;
};

export const addLocalMinutes = (value: string, minutes: number): string | undefined => {
  const date = parseCompatibleDateTime(value);
  if (!date) return undefined;
  date.setMinutes(date.getMinutes() + minutes);
  const pad = (number: number): string => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
