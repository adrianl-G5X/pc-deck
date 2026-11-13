// Prochains rendez-vous : lecture d'un agenda iCal (npm test)
const assert = require('assert');
const { nextEvents } = require('./calendar');

const now = Date.UTC(2026, 10, 12, 9, 0); // jeudi 12 novembre 2026, 10 h à Paris
const ics = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'SUMMARY:Passé', 'DTSTART:20261111T090000Z', 'DTEND:20261111T100000Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Dentiste\\, Dr Martin', 'DTSTART;TZID=Europe/Paris:20261113T143000', 'DTEND;TZID=Europe/Paris:20261113T153000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Annulé', 'STATUS:CANCELLED', 'DTSTART:20261112T120000Z', 'END:VEVENT',
  // Sport tous les lundis et jeudis depuis octobre, sauf ce jeudi
  'BEGIN:VEVENT', 'SUMMARY:Sport', 'DTSTART;TZID=Europe/Paris:20261001T180000', 'DURATION:PT1H',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', 'EXDATE;TZID=Europe/Paris:20261112T180000', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:Réu', 'DTSTART:20261112T083000Z', 'DTEND:20261112T0',
  ' 93000Z', 'END:VEVENT', // ligne repliée : fin à 9 h 30 UTC, réunion en cours
  'END:VCALENDAR',
].join('\r\n');

const list = nextEvents(ics, now);
assert.deepStrictEqual(list.map((e) => e.title), ['Réu', 'Dentiste, Dr Martin', 'Sport']);
assert.strictEqual(list[1].start, Date.UTC(2026, 10, 13, 13, 30)); // 14 h 30 à Paris = 13 h 30 UTC (heure d'hiver)
assert.strictEqual(list[2].start, Date.UTC(2026, 10, 16, 17, 0)); // jeudi 12 sauté (EXDATE) : lundi 16 à 18 h
console.log('Agenda : OK');
