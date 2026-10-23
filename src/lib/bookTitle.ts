import type {Book} from './library';

export function bookTitle(book:Pick<Book,'title'|'volumeCount'>):string{
 return (book.volumeCount??1)<=1?book.title.replace(/\s*·\s*1권\s*$/,'').trim():book.title;
}
export function volumeTitle(title:string,number:number,count:number):string{
 const base=title.replace(/\s*·\s*\d+권\s*$/,'').trim();
 return count>1?`${base} · ${number}권`:base;
}
