export const workScheduleOptions = [
  { value: '12x36_manha', label: '12x36 manhã' },
  { value: '12x36_noite', label: '12x36 noite' },
  { value: 'comercial', label: 'Horário comercial' },
];

export const weekdays = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

const DAY_SECONDS = 24 * 60 * 60;
const DAY_MILLISECONDS = DAY_SECONDS * 1000;

const parseDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
};

const parseTimeMinutes = (value) => {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

export const isValidWorkSchedule = (schedule) => {
  if (schedule?.type === '12x36_manha' || schedule?.type === '12x36_noite') {
    return Boolean(parseDate(schedule.startDate));
  }
  if (schedule?.type !== 'comercial'
    || parseTimeMinutes(schedule.startTime) === null
    || parseTimeMinutes(schedule.endTime) === null
    || parseTimeMinutes(schedule.endTime) <= parseTimeMinutes(schedule.startTime)
    || !Array.isArray(schedule.weekdays)
    || schedule.weekdays.length === 0
    || schedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return false;
  }
  return true;
};

export const getScheduledSeconds = (schedule, from, to) => {
  const firstDay = parseDate(from);
  const lastDay = parseDate(to);
  if (!isValidWorkSchedule(schedule) || !firstDay || !lastDay || firstDay > lastDay) return null;

  const firstDayNumber = Math.floor(firstDay.getTime() / DAY_MILLISECONDS);
  const lastDayNumber = Math.floor(lastDay.getTime() / DAY_MILLISECONDS);
  if (schedule.type === '12x36_manha' || schedule.type === '12x36_noite') {
    const anchor = parseDate(schedule.startDate);
    const anchorDayNumber = Math.floor(anchor.getTime() / DAY_MILLISECONDS);
    const firstEligibleDay = Math.max(firstDayNumber, anchorDayNumber);
    const firstShiftDay = firstEligibleDay + ((anchorDayNumber - firstEligibleDay) % 2 + 2) % 2;
    const shiftCount = firstShiftDay > lastDayNumber
      ? 0
      : Math.floor((lastDayNumber - firstShiftDay) / 2) + 1;
    return shiftCount * 12 * 60 * 60;
  }

  const startMinutes = parseTimeMinutes(schedule.startTime);
  const endMinutes = parseTimeMinutes(schedule.endTime);
  const weekdaysInSchedule = new Set(schedule.weekdays);
  let scheduledDays = 0;
  for (let dayNumber = firstDayNumber; dayNumber <= lastDayNumber; dayNumber += 1) {
    const dayOfWeek = new Date(dayNumber * DAY_MILLISECONDS).getUTCDay();
    if (weekdaysInSchedule.has(dayOfWeek)) scheduledDays += 1;
  }
  return scheduledDays * (endMinutes - startMinutes) * 60;
};

export const getWorkScheduleLabel = (schedule) => {
  const option = workScheduleOptions.find(({ value }) => value === schedule?.type);
  if (!option) return 'Escala não definida';
  if (schedule.type !== 'comercial') {
    return `${option.label} · primeiro plantão ${schedule.startDate || 'não informado'}`;
  }
  const dayLabels = weekdays
    .filter(({ value }) => schedule.weekdays?.includes(value))
    .map(({ label }) => label);
  return `${option.label} · ${schedule.startTime || '--:--'}–${schedule.endTime || '--:--'} · ${dayLabels.join(', ') || 'sem dias'}`;
};
