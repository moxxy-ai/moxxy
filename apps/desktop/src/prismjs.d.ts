declare module 'prismjs' {
  export interface Grammar {
    readonly [token: string]: unknown;
  }

  export interface Token {
    readonly type: string;
    readonly alias?: string | ReadonlyArray<string>;
    readonly content: TokenStream;
  }

  export type TokenStream = string | Token | ReadonlyArray<string | Token>;

  export interface PrismStatic {
    readonly languages: Record<string, Grammar>;
    tokenize(text: string, grammar: Grammar): ReadonlyArray<string | Token>;
  }

  const Prism: PrismStatic;
  export default Prism;
}

declare module 'prismjs/components/*.js';
