import { Readable } from 'node:stream';
import { ChannelType, Events, type Client, type Guild, type VoiceBasedChannel } from 'discord.js';
import type { VoiceLink } from './call.js';
import { watchVoiceConnection } from './connection-watch.js';
import type { CallChannel, GuildVoiceView } from './calls.js';

/** Silence that ends an utterance (Discord stops sending packets on silence). */
const UTTERANCE_SILENCE_MS = 1_200;
/** One utterance never runs longer than this. */
const MAX_UTTERANCE_MS = 60_000;
const JOIN_TIMEOUT_MS = 20_000;
/** A dropped connection gets this long to come back, then as long after a rejoin. */
const RECONNECT_GRACE_MS = 15_000;

type Voice = typeof import('@discordjs/voice');

/** Loaded on the first call: `@discordjs/voice` needs Node 22.12+, which the
 *  rest of the bot does not. */
async function loadVoice(): Promise<Voice> {
  try {
    return await import('@discordjs/voice');
  } catch (err) {
    throw new Error(
      `voice calls need @discordjs/voice (Node 22.12 or newer): ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function asCallChannel(channel: VoiceBasedChannel): CallChannel {
  const speakable = 'speakable' in channel ? channel.speakable : true;
  return { id: channel.id, guildId: channel.guild.id, joinable: channel.joinable && speakable };
}

async function viewGuild(guild: Guild, ownerId: string): Promise<GuildVoiceView> {
  const member = await guild.members.fetch(ownerId).catch(() => null);
  const ownerChannel = guild.voiceStates.cache.get(ownerId)?.channel ?? null;
  const voiceChannels = [...guild.channels.cache.values()]
    .filter((c): c is VoiceBasedChannel => c.type === ChannelType.GuildVoice)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(asCallChannel);
  return {
    ownerIsMember: member !== null,
    ownerChannel: ownerChannel ? asCallChannel(ownerChannel) : null,
    voiceChannels,
  };
}

/** What every server the bot is on knows about voice channels and the owner. */
export function viewGuilds(client: Client, ownerId: string): Promise<GuildVoiceView[]> {
  return Promise.all([...client.guilds.cache.values()].map((guild) => viewGuild(guild, ownerId)));
}

/** Follow the owner across voice channels (needs the GuildVoiceStates intent). */
export function onOwnerMoved(
  client: Client,
  ownerId: string,
  listener: (channelId: string | null) => void,
): () => void {
  const handler = (_before: unknown, after: { id: string; channelId: string | null }): void => {
    if (after.id === ownerId) listener(after.channelId);
  };
  client.on(Events.VoiceStateUpdate, handler);
  return () => client.off(Events.VoiceStateUpdate, handler);
}

/** Join a voice channel and expose it as a {@link VoiceLink} that hears only the owner. */
export async function connectVoice(
  client: Client,
  target: CallChannel,
  ownerId: string,
  logger?: { warn(msg: string, meta?: Record<string, unknown>): void },
): Promise<VoiceLink> {
  const voice = await loadVoice();
  const channel = await client.channels.fetch(target.id);
  if (!channel?.isVoiceBased()) throw new Error('that voice channel is gone');
  const connection = voice.joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });
  try {
    await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, JOIN_TIMEOUT_MS);
  } catch {
    connection.destroy();
    throw new Error('Discord did not let the bot into the channel in time (check its Connect permission)');
  }
  // Discord drops voice connections now and then: one that does not come back
  // is rejoined, then closed — which ends the call and tells the owner.
  watchVoiceConnection(connection, {
    graceMs: RECONNECT_GRACE_MS,
    onChange: (from, to) => {
      if (from !== to) logger?.warn('discord call: voice connection changed', { from, to });
    },
  });

  const player = voice.createAudioPlayer();
  connection.subscribe(player);
  const { receiver } = connection;
  const forOwner = (listener: () => void) => (userId: string) => {
    if (userId === ownerId) listener();
  };

  return {
    onSpeechStart: (listener) => {
      const handler = forOwner(listener);
      receiver.speaking.on('start', handler);
      return () => receiver.speaking.off('start', handler);
    },
    onSpeechEnd: (listener) => {
      const handler = forOwner(listener);
      receiver.speaking.on('end', handler);
      return () => receiver.speaking.off('end', handler);
    },
    onClosed: (listener) => {
      const handler = (): void => listener();
      connection.on(voice.VoiceConnectionStatus.Destroyed, handler);
      return () => connection.off(voice.VoiceConnectionStatus.Destroyed, handler);
    },
    captureUtterance: () =>
      new Promise((resolve) => {
        const stream = receiver.subscribe(ownerId, {
          end: { behavior: voice.EndBehaviorType.AfterSilence, duration: UTTERANCE_SILENCE_MS },
        });
        const packets: Uint8Array[] = [];
        const cap = setTimeout(() => stream.destroy(), MAX_UTTERANCE_MS);
        let settled = false;
        const done = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(cap);
          resolve(packets);
        };
        stream.on('data', (packet: Buffer) => packets.push(new Uint8Array(packet)));
        stream.once('end', done);
        stream.once('close', done);
        stream.once('error', done);
      }),
    play: (clip) =>
      new Promise((resolve) => {
        const resource = voice.createAudioResource(Readable.from([Buffer.from(clip)]), {
          inputType: voice.StreamType.OggOpus,
        });
        const finish = (): void => {
          player.off(voice.AudioPlayerStatus.Idle, finish);
          player.off('error', finish);
          resolve();
        };
        player.on(voice.AudioPlayerStatus.Idle, finish);
        player.on('error', finish);
        player.play(resource);
      }),
    stop: () => {
      player.stop(true);
    },
    close: () => {
      player.stop(true);
      if (connection.state.status !== voice.VoiceConnectionStatus.Destroyed) connection.destroy();
    },
  };
}
