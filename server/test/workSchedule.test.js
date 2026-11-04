import test from 'node:test';
import assert from 'node:assert/strict';
import { getScheduledSeconds, isValidWorkSchedule } from '../../src/lib/workSchedule.js';

test('counts 12x36 shifts from the first scheduled work date', () => {
  const schedule = { type: '12x36_manha', startDate: '2026-11-04' };
  assert.equal(getScheduledSeconds(schedule, '2026-11-04', '2026-11-07'), 24 * 60 * 60);
  assert.equal(getScheduledSeconds(schedule, '2026-11-05', '2026-11-07'), 12 * 60 * 60);
  assert.equal(getScheduledSeconds(schedule, '2026-11-01', '2026-11-03'), 0);
});

test('counts selected commercial weekdays and hours', () => {
  const schedule = {
    type: 'comercial',
    startTime: '07:00',
    endTime: '15:30',
    weekdays: [1, 2, 3, 4, 5],
  };
  assert.equal(getScheduledSeconds(schedule, '2026-11-02', '2026-11-08'), 5 * 8.5 * 60 * 60);
});

test('does not calculate an undefined or invalid schedule', () => {
  assert.equal(getScheduledSeconds(null, '2026-11-02', '2026-11-08'), null);
  assert.equal(isValidWorkSchedule({ type: 'comercial', startTime: '08:00', endTime: '07:00', weekdays: [1] }), false);
});
