interface CssCustomProperties {
  getPropertyValue(name: string): string;
}

interface VoiceOrbPalette {
  readonly primary: string;
  readonly highlight: string;
}

type Rgb = readonly [number, number, number];

const BRAND_FALLBACK: Rgb = [236, 72, 153];
const ERROR_FALLBACK: Rgb = [239, 68, 68];

function clampChannel(value: number): number {
  return Math.round(Math.min(255, Math.max(0, value)));
}

function parseHexColor(value: string): Rgb | null {
  const hex = value.slice(1);
  if (hex.length === 3) {
    return [
      Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    ];
  }
  if (hex.length !== 6) return null;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function parseRgbColor(value: string): Rgb | null {
  const channels = value.match(/[\d.]+/g);
  if (!channels || channels.length < 3) return null;
  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined) return null;
  return [clampChannel(Number(red)), clampChannel(Number(green)), clampChannel(Number(blue))];
}

function parseColor(value: string, fallback: Rgb): Rgb {
  const normalized = value.trim().toLowerCase();
  const parsed = normalized.startsWith('#')
    ? parseHexColor(normalized)
    : normalized.startsWith('rgb')
      ? parseRgbColor(normalized)
      : null;
  if (!parsed || parsed.some(Number.isNaN)) return fallback;
  return parsed;
}

function highlight([red, green, blue]: Rgb): Rgb {
  const mix = (channel: number): number => clampChannel(channel + (255 - channel) * 0.48);
  return [mix(red), mix(green), mix(blue)];
}

function serialize([red, green, blue]: Rgb): string {
  return `${red}, ${green}, ${blue}`;
}

/** Resolves canvas colors from the same semantic tokens as the desktop UI. */
export function resolveVoiceOrbPalette(
  style: CssCustomProperties,
  isError: boolean,
): VoiceOrbPalette {
  const fallback = isError ? ERROR_FALLBACK : BRAND_FALLBACK;
  const property = isError ? '--color-red' : '--color-primary';
  const primary = parseColor(style.getPropertyValue(property), fallback);
  return { primary: serialize(primary), highlight: serialize(highlight(primary)) };
}
