import type { PiiCategory } from '@moxxy/anonymizer';

/** Friendly labels for each detectable category (UI only). */
export const CATEGORY_LABELS: Record<PiiCategory, string> = {
  email: 'Emails',
  phone: 'Phone numbers',
  creditCard: 'Credit cards',
  ssn: 'SSNs',
  nationalId: 'National IDs',
  ipv4: 'IPv4 addresses',
  ipv6: 'IPv6 addresses',
  mac: 'MAC addresses',
  iban: 'IBANs',
  url: 'URLs',
  date: 'Dates',
  person: 'Names',
  org: 'Organizations',
  location: 'Locations',
  custom: 'Custom terms',
};

/** Built-in (regex) categories the user can toggle. `date` is included but
 *  defaults off (high false-positive rate). NER categories (person/org/location)
 *  are controlled by the separate "Detect names" toggle; `custom` by the terms box. */
export const TOGGLE_CATEGORIES: readonly PiiCategory[] = [
  'email',
  'phone',
  'creditCard',
  'ssn',
  'ipv4',
  'ipv6',
  'mac',
  'iban',
  'url',
  'date',
];
