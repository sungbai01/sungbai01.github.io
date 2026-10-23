import type {Book} from '../src/lib/library';
export type ShareCardLayout={title:string;quote:string;quotePages?:{start:number;end:number};imagePosition:number;backgroundUrl?:string;backgroundName?:string};
export type ShareCardPreview=Pick<Book,'title'|'author'|'color'|'displayPrompt'|'volumeNumber'>&ShareCardLayout&{backgroundUrl?:string;backgroundName?:string};
