// nativewind ships no types for its tailwind preset entry point.
declare module 'nativewind/preset' {
  import type { Config } from 'tailwindcss';

  const preset: Config;
  export default preset;
}
