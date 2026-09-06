import {EditorialSurface} from './editorial-background';
import {hasSceneMedia} from './media-source';
import type {SceneTemplateProps} from './types';
import {fade} from './editorial-typography';

/** Exact words with a readable attribution; no decorative oversized quotation mark. */
function QuoteScene(props:SceneTemplateProps){
 const {variables,width,height,progress,motionProgress=progress,safeZone}=props;
 const overMedia=hasSceneMedia(variables);
 const u=Math.min(width,height),top=Math.max(height*.16,safeZone.top),bottom=height-Math.max(height*.23,safeZone.bottom);
 const side=Math.max(width*.13,safeZone.left,safeZone.right);
 return <EditorialSurface {...props} template="quote">
  <div style={{position:'absolute',left:side,top:(top+bottom)/2,width:width-side*2,transform:'translateY(-50%)',textAlign:'center',opacity:fade((motionProgress-.03)/.24)}}>
   <div style={{fontSize:u*.067,fontWeight:500,lineHeight:1.25,letterSpacing:'-.025em',textWrap:'balance',overflowWrap:'anywhere'}}>“{String(variables.quote??'')}”</div>
   <div style={{fontSize:u*.041,fontWeight:400,color:overMedia?'#fff':'#b7b7bc',lineHeight:1.3,marginTop:u*.065,textWrap:'balance',overflowWrap:'anywhere'}}>{String(variables.attribution??'')}</div>
  </div>
 </EditorialSurface>;
}

export const QuoteSceneTemplate = QuoteScene;
