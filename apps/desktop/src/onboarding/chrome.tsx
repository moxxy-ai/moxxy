/**
 * Shared onboarding chrome — the public surface every step and the flow
 * orchestrator import from. The implementation now lives in focused
 * leaf modules under ./chrome/ (the wizard Shell, the step primitives,
 * and the style tokens); this barrel keeps the single `./chrome` import
 * path stable for consumers.
 */

export { Shell } from './chrome/Shell';
export { StepCard, Nav, PrimaryButton, SecondaryButton, SuccessRow, Pulse } from './chrome/primitives';
export { inputStyle, secondaryBtnStyle, pickerBtnStyle } from './chrome/styles';
