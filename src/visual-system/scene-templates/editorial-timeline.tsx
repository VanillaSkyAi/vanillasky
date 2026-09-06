import {EditorialSurface} from './editorial-background';
import type {SceneTemplateProps} from './types';
import {fade} from './editorial-typography';
export const timelineTiming=(index:number)=>({nodeStart:index===0?.06:.23+(index-1)*.11,lineStart:.14+index*.11,lineDuration:.09,entranceDuration:.16});

/** A fine line establishes order; labels carry the sequence without dates. */
function TimelineScene(props:SceneTemplateProps){
 const {variables,progress,motionProgress=progress,width,height,safeZone}=props;
 const events=(Array.isArray(variables.events)?variables.events:[]).slice(0,5).map(e=>({label:String(e?.label??'')}));
 const portrait=height>width,u=Math.min(width,height),n=Math.max(1,events.length);
 const side=Math.max(width*.13,safeZone.left,safeZone.right),available=width-side*2;
 const top=Math.max(height*.2,safeZone.top),bottom=height-Math.max(height*.24,safeZone.bottom);
 const slot=portrait?(bottom-top)/n:available/n;
 const points=events.map((_,i)=>({x:portrait?side:side+slot*(i+.5),y:portrait?top+slot*(i+.5):height*.43}));
 const radius=u*.0045;
 return <EditorialSurface {...props} template="timeline">
  {points.slice(0,-1).map((point,i)=>{
   const next=points[i+1],timing=timelineTiming(i),line=fade((motionProgress-timing.lineStart)/timing.lineDuration);
   return <div key={`line-${i}`} data-step-connector="true" style={{position:'absolute',left:point.x,top:point.y,width:portrait?u*.001:next.x-point.x,height:portrait?next.y-point.y:u*.001,background:'#fff',opacity:.3,transform:portrait?`scaleY(${line})`:`scaleX(${line})`,transformOrigin:portrait?'top':'left'}}/>;
  })}
  {points.map((point,i)=>{
   const timing=timelineTiming(i),event=events[i],opacity=fade((motionProgress-timing.nodeStart)/timing.entranceDuration);
   const textW=portrait?available-u*.055:slot*.86;
   return <div key={i} data-template-item="steps" style={{opacity}}>
    <div aria-hidden="true" style={{position:'absolute',left:point.x-radius,top:point.y-radius,width:radius*2,height:radius*2,borderRadius:'50%',background:'#fff'}}/>
    <div style={{position:'absolute',left:portrait?point.x+u*.055:point.x-textW/2,top:portrait?point.y:point.y+u*.05,width:textW,transform:portrait?'translateY(-50%)':undefined,textAlign:portrait?'left':'center'}}>
     <div style={{fontSize:u*(portrait?.052:.041),fontWeight:500,lineHeight:1.22,letterSpacing:'-.025em',textWrap:'balance',overflowWrap:'anywhere'}}>{event.label}</div>
    </div>
   </div>;
  })}
 </EditorialSurface>;
}

export const TimelineSceneTemplate = TimelineScene;
