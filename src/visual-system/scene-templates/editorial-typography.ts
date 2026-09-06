/** Shared typography for quiet editorial scenes. */
export const editorialFont = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Roboto, Arial, sans-serif';
export const fade = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export const editorialLabel = (unit: number) => ({fontSize:unit*.042,fontWeight:400,color:'#b7b7bc',lineHeight:1.25} as const);
