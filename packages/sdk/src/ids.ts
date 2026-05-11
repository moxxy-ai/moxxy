declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type EventId = Brand<string, 'EventId'>;
export type TurnId = Brand<string, 'TurnId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type PluginId = Brand<string, 'PluginId'>;
export type SkillId = Brand<string, 'SkillId'>;

export const asEventId = (s: string): EventId => s as EventId;
export const asTurnId = (s: string): TurnId => s as TurnId;
export const asToolCallId = (s: string): ToolCallId => s as ToolCallId;
export const asSessionId = (s: string): SessionId => s as SessionId;
export const asPluginId = (s: string): PluginId => s as PluginId;
export const asSkillId = (s: string): SkillId => s as SkillId;
