/** Strip only a complete opening sentence repeated word-for-word, never a semantic paraphrase. */
export function continueAfterOpening(narration: string, earlier: readonly string[]): string {
 const words=(value:string)=>Array.from(value.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu));
 let remaining=narration;
 for (const previous of [...earlier].reverse()) {
  const known=words(previous),current=words(remaining);
  if (known.length<5 || known.length>current.length) continue;
  if (!known.every((word,index)=>word[0].toLowerCase()===current[index][0].toLowerCase())) continue;
  if (known.length===current.length) return '';
  const last=current[known.length-1];
  const suffix=remaining.slice(last.index!+last[0].length);
  // A shared clause is not a repeated sentence: removing it could change the claim.
  const boundary=suffix.match(/^[”"'’\])]*[.!?…]+[\s”"'’\])]*/u);
  if (boundary) remaining=suffix.slice(boundary[0].length).trim();
 }
 return remaining;
}
