import type {SceneTemplateProps} from './types';
import {editorialFont,fade} from './editorial-typography';

/** Exact words with a readable attribution; no decorative oversized quotation mark. */
function QuoteScene({variables,width,height,progress,motionProgress=progress,safeZone}:SceneTemplateProps){
 const u=Math.min(width,height),top=Math.max(height*.16,safeZone.top),bottom=height-Math.max(height*.23,safeZone.bottom);
 const side=Math.max(width*.13,safeZone.left,safeZone.right);
 return <div data-template="quote" style={{position:'absolute',inset:0,background:'#000',color:'#fff',fontFamily:editorialFont,overflow:'hidden'}}>
  <div style={{position:'absolute',left:side,top:(top+bottom)/2,width:width-side*2,transform:'translateY(-50%)',textAlign:'center',opacity:fade((motionProgress-.03)/.24)}}>
   <div style={{fontSize:u*.067,fontWeight:500,lineHeight:1.25,letterSpacing:'-.025em',textWrap:'balance',overflowWrap:'anywhere'}}>“{String(variables.quote??'')}”</div>
   <div style={{fontSize:u*.041,fontWeight:400,color:'#b7b7bc',lineHeight:1.3,marginTop:u*.065,textWrap:'balance',overflowWrap:'anywhere'}}>{String(variables.attribution??'')}</div>
  </div>
 </div>;
}

export const QuoteSceneTemplate = QuoteScene;
