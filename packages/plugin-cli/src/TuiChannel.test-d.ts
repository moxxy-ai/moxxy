import { expectTypeOf } from 'vitest';
import type { Channel } from '@moxxy/sdk';
import type { TuiChannel} from './TuiChannel.js';
import { type TuiStartOpts } from './TuiChannel.js';

// Compile-time assertion: TuiChannel satisfies the Channel<TuiStartOpts> contract.
expectTypeOf<TuiChannel>().toMatchTypeOf<Channel<TuiStartOpts>>();
