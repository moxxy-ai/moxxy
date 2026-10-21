// ---------- Chat media library -----------------------------------------------

/** Who put an item into the conversation: the person, or the agent. */
export type ChatMediaOwner = 'me' | 'agent';

interface ChatMediaItemBase {
  /** Stable for one log: where the item sits (`a:<seq>:<i>` an attachment,
   *  `t:<seq>:<i>` a tool image, `f:` / `l:` a linked file or a link). */
  readonly id: string;
  readonly owner: ChatMediaOwner;
  /** The newest message that carried it. Repeats show once, at their latest. */
  readonly seq: number;
  readonly ts: number;
  /** Words around it (the message, the tool's note), for the search. */
  readonly caption: string;
}

export interface ChatMediaImage extends ChatMediaItemBase {
  readonly kind: 'image';
  readonly mediaType: string;
  readonly name: string | null;
  readonly bytes: number;
}

export interface ChatMediaFile extends ChatMediaItemBase {
  readonly kind: 'file';
  readonly name: string;
  readonly mediaType: string | null;
  /** Null while unknown: a linked file that is no longer on the disk. */
  readonly bytes: number | null;
  /** A file on this computer the message linked to; null for an attached copy. */
  readonly path: string | null;
}

export interface ChatMediaLink extends ChatMediaItemBase {
  readonly kind: 'link';
  readonly url: string;
  /** The link's own words when it had any (`[label](url)`). */
  readonly label: string | null;
}

export type ChatMediaItem = ChatMediaImage | ChatMediaFile | ChatMediaLink;

/** One chat's library, newest first. */
export interface ChatMediaLibrary {
  readonly items: ReadonlyArray<ChatMediaItem>;
}

/** An image's bytes, small (a thumbnail) or one slice of the whole. */
export interface ChatMediaImageData {
  readonly mediaType: string;
  readonly base64: string;
}

export interface ChatMediaImageChunk {
  readonly mediaType: string;
  readonly data: string;
  /** The whole image's length in base64 characters. */
  readonly total: number;
}
