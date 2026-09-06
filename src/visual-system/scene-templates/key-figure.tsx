import {EditorialSurface} from './editorial-background';
import {hasSceneMedia} from './media-source';
import type {SceneTemplateProps} from './types';
import {editorialLabel,fade} from './editorial-typography';

/** One supplied figure, shown directly without a count-up that invents intermediate values. */
function KeyFigureScene(props:SceneTemplateProps){
 const {variables,width,height,progress,motionProgress=progress,safeZone}=props;
 const overMedia=hasSceneMedia(variables);
 const u=Math.min(width,height),side=Math.max(width*.13,safeZone.left,safeZone.right),available=width-side*2;
 const top=Math.max(height*.16,safeZone.top),bottom=height-Math.max(height*.23,safeZone.bottom),value=String(variables.value??'');
 return <EditorialSurface {...props} template="keyFigure">
  <div style={{position:'absolute',left:side,top:(top+bottom)/2,width:available,transform:'translateY(-50%)',textAlign:'center',opacity:fade((motionProgress-.03)/.22)}}>
   <div style={{fontSize:Math.min(u*.22,available/Math.max(1,value.length*.6)),fontWeight:500,lineHeight:1.05,letterSpacing:'-.045em',fontVariantNumeric:'tabular-nums'}}>{value}</div>
   <div style={{...editorialLabel(u),color:overMedia?'#fff':'#b7b7bc',marginTop:u*.045,textWrap:'balance',overflowWrap:'anywhere'}}>{String(variables.label??'')}</div>
  </div>
 </EditorialSurface>;
}

export const KeyFigureSceneTemplate = KeyFigureScene;
