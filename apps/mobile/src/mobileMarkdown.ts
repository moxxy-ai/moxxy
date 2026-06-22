import { parseBlocks, tokenizeInline, type Block, type InlineTok } from '@moxxy/chat-model/markdown';

export type MobileMarkdownBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly text: string }
  | { readonly kind: 'paragraph'; readonly inline: ReadonlyArray<InlineTok> }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: ReadonlyArray<ReadonlyArray<InlineTok>> }
  | { readonly kind: 'code'; readonly lang: string | null; readonly body: string }
  | {
      readonly kind: 'table';
      readonly header: ReadonlyArray<ReadonlyArray<InlineTok>>;
      readonly rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<InlineTok>>>;
    };

export function buildMobileMarkdownBlocks(text: string): MobileMarkdownBlock[] {
  return parseBlocks(text)
    .map(toMobileMarkdownBlock)
    .filter((block): block is MobileMarkdownBlock => block !== null);
}

function toMobileMarkdownBlock(block: Block): MobileMarkdownBlock | null {
  if (block.kind === 'blank') return null;
  if (block.kind === 'heading') return block;
  if (block.kind === 'paragraph') return { kind: 'paragraph', inline: tokenizeInline(block.text) };
  if (block.kind === 'list') {
    return {
      kind: 'list',
      ordered: block.ordered,
      items: block.items.map(tokenizeInline),
    };
  }
  if (block.kind === 'code') return block;
  if (block.kind === 'table') {
    return {
      kind: 'table',
      header: block.header.map(tokenizeInline),
      rows: block.rows.map((row) => row.map(tokenizeInline)),
    };
  }
  return null;
}
