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

/** Only the first ordinary body beat is eligible; later callbacks may intentionally recur. */
export function createOpeningContinuation(initialOpening?: string) {
 const earlier:string[]=initialOpening?[initialOpening]:[];
 let bodyStarted=false;
 const copy=(authored:string,narration:string):string=>{
  if (continueAfterOpening(authored,earlier)!=='') return authored;
  const next=continueAfterOpening(narration,earlier).trim();
  // Copy the entire new thought or retain the authored text. Never split a
  // decimal, abbreviation or qualifying clause to satisfy the copy budget.
  return next && [...next].length<=65 && /[.!?…][”"’')\]]*$/u.test(next) ? next : authored;
 };
 return {
  copy,
  remember(line:string) { if (line.trim()) earlier.push(line); },
  narration(line:string) { return continueAfterOpening(line,earlier); },
  line(rawLine:string):string|null {
   if (bodyStarted || earlier.length===0) return rawLine;
   let part:Record<string,unknown>;
   try { part=JSON.parse(rawLine) as Record<string,unknown>; } catch { return rawLine; }
   if (!part || part.type!=='scene.add' || part.placement==='closer') return rawLine;
   const scene=part.scene as Record<string,unknown>|undefined;
   if (!scene) return rawLine;
   if (typeof scene.narration!=='string') { bodyStarted=true; return rawLine; }
   const narration=continueAfterOpening(scene.narration,earlier);
   if (!narration && scene.templateId==='cinemaMedia') return null;
   const variables=scene.variables as Record<string,unknown>|undefined;
   if (!narration && scene.templateId==='chapterTitle' && typeof variables?.title==='string' && !continueAfterOpening(variables.title,earlier)) return null;
   bodyStarted=true;
   // A graphic can contain additional evidence even when its narration repeats.
   // Keep that scene intact rather than silently deleting its figure/quote/event.
   if (!narration) return rawLine;
   const field=scene.templateId==='cinemaMedia'?'fallbackText':scene.templateId==='chapterTitle'?'title':undefined;
   const authored=field && variables?.[field];
   const updated=typeof authored==='string'?copy(authored,narration):undefined;
   const copyChanged=typeof authored==='string' && updated!==authored;
   if (narration===scene.narration && !copyChanged) return rawLine;
   return JSON.stringify({...part,scene:{...scene,narration,...(copyChanged?{variables:{...variables,[field!]:updated}}:{})}});
  },
 };
}
