import {EditorialSurface} from './editorial-background';
import {hasSceneMedia} from './media-source';
import type {SceneTemplateProps} from './types';
import {editorialLabel,fade} from './editorial-typography';

/** Two concise alternatives, with equal visual weight and a quiet sequential reveal. */
function ComparisonScene(props:SceneTemplateProps){
 const {variables,width,height,progress,motionProgress=progress,safeZone}=props;
 const overMedia=hasSceneMedia(variables);
 const portrait=height>width,u=Math.min(width,height);
 const side=Math.max(width*.12,safeZone.left,safeZone.right);
 const top=Math.max(height*.2,safeZone.top),bottom=height-Math.max(height*.23,safeZone.bottom);
 const area=bottom-top,cy=(top+bottom)/2,available=width-side*2;
 const entries=[{label:String(variables.leftLabel??''),text:String(variables.leftText??'')},{label:String(variables.rightLabel??''),text:String(variables.rightText??'')}];
 const textWidth=portrait?available:available*.39;
 return <EditorialSurface {...props} template="comparison">
  <div aria-hidden="true" style={{position:'absolute',left:portrait?width*.32:width/2,top:portrait?cy:top+area*.18,width:portrait?width*.36:u*.001,height:portrait?u*.001:area*.64,background:'#fff',opacity:.22*fade((motionProgress-.16)/.18)}}/>
  {entries.map((entry,i)=><div key={i} data-comparison-side={i===0?'left':'right'} style={{position:'absolute',left:portrait?side:side+available*(i===0?.055:.555),top:portrait?top+area*(i===0?.25:.75):cy,width:textWidth,transform:'translateY(-50%)',textAlign:'center',opacity:fade((motionProgress-.04-i*.22)/.2)}}>
   {entry.label&&<div style={{...editorialLabel(u),color:overMedia?'#fff':'#b7b7bc',marginBottom:u*.028}}>{entry.label}</div>}
   <div style={{fontSize:u*.058,fontWeight:500,lineHeight:1.22,letterSpacing:'-.025em',textWrap:'balance',overflowWrap:'anywhere'}}>{entry.text}</div>
  </div>)}
 </EditorialSurface>;
}

export const ComparisonSceneTemplate = ComparisonScene;
