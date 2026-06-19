import { STRUCTURED_CATEGORIES, type PiiCategory } from '@moxxy/anonymizer';

/** Friendly labels for each detectable category (UI only). The `Record<PiiCategory,…>`
 *  type makes this exhaustive: adding a new `PiiCategory` upstream fails the build
 *  here until it gets a label, so the UI can't silently drop a detector. */
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

/** Built-in (regex) categories the user can toggle. Derived from the anonymizer's
 *  own `STRUCTURED_CATEGORIES` (the source of truth) plus an explicit `date`
 *  opt-in — `date` is shown but defaults off (high false-positive rate). Deriving
 *  rather than re-listing means a new structured detector upstream automatically
 *  appears in the UI instead of silently drifting out. NER categories
 *  (person/org/location) are controlled by the separate "Detect names" toggle;
 *  `custom` by the terms box. */
export const TOGGLE_CATEGORIES: readonly PiiCategory[] = [...STRUCTURED_CATEGORIES, 'date'];
