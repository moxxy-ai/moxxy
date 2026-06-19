import { ALL_CATEGORIES, DETECTABLE_CATEGORIES, type PiiCategory, type Region } from '@moxxy/anonymizer';

/** Friendly labels for each detectable category (UI only). */
export const CATEGORY_LABELS: Record<PiiCategory, string> = {
  email: 'Emails',
  phone: 'Phone numbers',
  creditCard: 'Credit cards',
  ssn: 'US Social Security',
  nationalId: 'National IDs',
  taxId: 'Tax IDs',
  healthId: 'Health IDs',
  passport: 'Passports',
  driverLicense: 'Driver licenses',
  postalCode: 'Postal codes',
  bankAccount: 'Bank accounts',
  crypto: 'Crypto wallets',
  deviceId: 'Device IDs',
  vehicleId: 'Vehicle IDs',
  secret: 'API keys & secrets',
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

/** Built-in (regex) categories the user can toggle, in canonical order. Derived
 *  from the engine's dictionary so adding a detector surfaces its category
 *  automatically. NER categories (person/org/location) are controlled by the
 *  separate names toggle; `custom` by the terms box, so neither appears here. */
export const TOGGLE_CATEGORIES: readonly PiiCategory[] = ALL_CATEGORIES.filter((c) =>
  DETECTABLE_CATEGORIES.includes(c),
);

/** Human labels for the market selector (global detectors always run). */
export const REGION_LABELS: Record<Region, string> = {
  global: 'Global',
  PL: 'Poland',
  UK: 'United Kingdom',
  US: 'United States',
};

/** Markets the user can scope detection to (global is implicit/always on). */
export const SELECTABLE_REGIONS: readonly Region[] = ['PL', 'UK', 'US'];
