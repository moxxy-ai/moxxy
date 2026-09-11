/** A byte-bounded decoder; UTF-8 is decoded only after a complete frame arrives. */
export class JsonLineDecoder {
  private pending = Buffer.alloc(0);
  constructor(private readonly limit: number) {}

  push(bytes: Buffer): unknown[] {
    const frames: unknown[] = [];
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      const part = bytes.subarray(offset, end);
      if (this.pending.length + part.length > this.limit) throw new Error('Computer Use protocol frame limit exceeded');
      this.pending = Buffer.concat([this.pending, part]);
      if (newline < 0) break;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(this.pending);
      frames.push(JSON.parse(text));
      this.pending = Buffer.alloc(0);
      offset = newline + 1;
    }
    return frames;
  }

  finish(): void {
    if (this.pending.length) throw new Error('Computer Use protocol incomplete frame');
  }
}
