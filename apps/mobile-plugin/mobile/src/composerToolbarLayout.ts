export interface ComposerToolbarLayoutInput {
  readonly screenWidth: number;
}

export interface ComposerToolbarLayout {
  readonly actionButtonSize: number;
  readonly sendButtonSize: number;
  readonly iconHitSlop: number;
  readonly voiceMaxWidth: number;
  readonly modelMinWidth: number;
  readonly modelMaxWidth: number;
  readonly showContextMeter: boolean;
}

export function buildComposerToolbarLayout(input: ComposerToolbarLayoutInput): ComposerToolbarLayout {
  const width = Math.max(0, input.screenWidth);
  const compact = width < 360;
  const regularPhone = width < 430;

  return {
    actionButtonSize: 44,
    sendButtonSize: 44,
    iconHitSlop: 6,
    voiceMaxWidth: compact ? 78 : 96,
    modelMinWidth: 0,
    modelMaxWidth: compact ? 118 : regularPhone ? 154 : 190,
    showContextMeter: width >= 340,
  };
}
