import type {SceneTemplateProps} from './types';
import {editorialFont,editorialLabel,fade} from './editorial-typography';

/** One supplied figure, shown directly without a count-up that invents intermediate values. */
function KeyFigureScene({variables,width,height,progress,motionProgress=progress,safeZone}:SceneTemplateProps){
 const u=Math.min(width,height),side=Math.max(width*.13,safeZone.left,safeZone.right),available=width-side*2;
 const top=Math.max(height*.16,safeZone.top),bottom=height-Math.max(height*.23,safeZone.bottom),value=String(variables.value??'');
 return <div data-template="keyFigure" style={{position:'absolute',inset:0,background:'#000',color:'#fff',fontFamily:editorialFont,overflow:'hidden'}}>
  <div style={{position:'absolute',left:side,top:(top+bottom)/2,width:available,transform:'translateY(-50%)',textAlign:'center',opacity:fade((motionProgress-.03)/.22)}}>
   <div style={{fontSize:Math.min(u*.22,available/Math.max(1,value.length*.6)),fontWeight:500,lineHeight:1.05,letterSpacing:'-.045em',fontVariantNumeric:'tabular-nums'}}>{value}</div>
   <div style={{...editorialLabel(u),marginTop:u*.045,textWrap:'balance',overflowWrap:'anywhere'}}>{String(variables.label??'')}</div>
  </div>
 </div>;
}

export const KeyFigureSceneTemplate = KeyFigureScene;
