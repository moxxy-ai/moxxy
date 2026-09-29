import { VoiceCall, type VoiceCallDeps, type VoiceLink } from './call.js';

/** A voice channel the bot could call in. */
export interface CallChannel {
  readonly id: string;
  readonly guildId: string;
  /** The bot has Connect + Speak there and the channel has room. */
  readonly joinable: boolean;
}

/** What the gateway knows about one server the bot is on. */
export interface GuildVoiceView {
  readonly ownerIsMember: boolean;
  /** The voice channel the owner is in on this server, if any. */
  readonly ownerChannel: CallChannel | null;
  readonly voiceChannels: ReadonlyArray<CallChannel>;
}

export interface CallTarget {
  readonly channel: CallChannel;
  /** The owner is already in it — no need to ring. */
  readonly ownerPresent: boolean;
}

/** Join the owner where they already are; otherwise ring in the first voice
 *  channel the bot may join on a server the owner is on. */
export function pickCallChannel(guilds: ReadonlyArray<GuildVoiceView>): CallTarget | null {
  for (const guild of guilds) {
    if (guild.ownerChannel?.joinable) return { channel: guild.ownerChannel, ownerPresent: true };
  }
  for (const guild of guilds) {
    if (!guild.ownerIsMember) continue;
    const channel = guild.voiceChannels.find((c) => c.joinable);
    if (channel) return { channel, ownerPresent: false };
  }
  return null;
}

export function callChannelUrl(channel: CallChannel): string {
  return `https://discord.com/channels/${channel.guildId}/${channel.id}`;
}

/** The Discord side of calls; the channel implements it over discord.js. */
export interface CallPorts extends Pick<VoiceCallDeps, 'transcribe' | 'answer' | 'speak' | 'onError'> {
  findChannel(): Promise<CallTarget | null>;
  connect(channel: CallChannel): Promise<VoiceLink>;
  notifyOwner(text: string): Promise<void>;
  /** The owner joined, left or switched voice channels (null = none). */
  onOwnerMoved(listener: (channelId: string | null) => void): () => void;
}

export interface CallsOptions {
  /** How long a call rings before it counts as missed. */
  readonly ringMs?: number;
  readonly bargeInMs?: number;
  readonly minPackets?: number;
}

const DEFAULT_RING_MS = 2 * 60_000;

/**
 * Calls between the owner and the bot, one at a time. `/call` (or the agent's
 * `discord_call` tool) joins the owner's voice channel, or rings: the bot
 * waits in a voice channel and DMs a link. The call ends on `/hangup`, when
 * the owner leaves, or when nobody picks up.
 */
export class Calls {
  private call: VoiceCall | null = null;
  private starting = false;

  constructor(
    private readonly ports: CallPorts,
    private readonly opts: CallsOptions = {},
  ) {}

  get active(): boolean {
    return this.call?.active === true;
  }

  /** Start a call; `greeting` is what the bot says first (why it called). */
  async start(opts: { readonly greeting?: string } = {}): Promise<string> {
    if (this.active || this.starting) return 'A call is already on — /hangup ends it.';
    this.starting = true;
    try {
      const target = await this.ports.findChannel();
      if (!target) {
        return 'No voice channel to call in: the bot needs a server you are both on with a voice channel it may join (Connect + Speak).';
      }
      let link: VoiceLink;
      try {
        link = await this.ports.connect(target.channel);
      } catch (err) {
        return `Could not join the voice channel: ${err instanceof Error ? err.message : String(err)}`;
      }
      return await this.begin(link, target, opts.greeting);
    } finally {
      this.starting = false;
    }
  }

  /** Say something in the call, in turn with its replies; false when there is none. */
  say(text: string): boolean {
    if (!this.call?.active) return false;
    void this.call.say(text);
    return true;
  }

  hangUp(): string {
    if (!this.call?.active) return 'There is no call to end.';
    this.call.hangUp();
    return '📴 Call ended.';
  }

  private async begin(link: VoiceLink, target: CallTarget, greeting: string | undefined): Promise<string> {
    const { ports } = this;
    const call = new VoiceCall(link, {
      transcribe: ports.transcribe,
      answer: ports.answer,
      speak: ports.speak,
      ...(ports.onError ? { onError: ports.onError } : {}),
      ...(this.opts.bargeInMs !== undefined ? { bargeInMs: this.opts.bargeInMs } : {}),
      ...(this.opts.minPackets !== undefined ? { minPackets: this.opts.minPackets } : {}),
    });
    this.call = call;
    const channelId = target.channel.id;
    let ownerHere = target.ownerPresent;
    let ringTimer: ReturnType<typeof setTimeout> | null = null;
    const greet = (): void => {
      if (greeting) void call.say(greeting);
    };
    const offMoved = ports.onOwnerMoved((movedTo) => {
      if (movedTo === channelId) {
        if (ownerHere) return;
        ownerHere = true;
        if (ringTimer) clearTimeout(ringTimer);
        greet();
        return;
      }
      if (ownerHere) call.hangUp();
    });
    call.onEnded(() => {
      offMoved();
      if (ringTimer) clearTimeout(ringTimer);
      if (this.call === call) this.call = null;
    });

    if (ownerHere) {
      greet();
      return `📞 On a call in <#${channelId}> — just talk; /hangup ends it.`;
    }
    ringTimer = setTimeout(() => {
      if (ownerHere) return;
      call.hangUp();
      ports.notifyOwner('📵 Missed call — nobody joined, so I hung up.').catch((err: unknown) => ports.onError?.(err));
    }, this.opts.ringMs ?? DEFAULT_RING_MS);
    ringTimer.unref?.();
    const url = callChannelUrl(target.channel);
    await ports.notifyOwner(`📞 ${greeting ? `${greeting} — ` : ''}Moxxy is calling. Join: ${url}`);
    return `📞 Calling — join ${url}`;
  }
}
