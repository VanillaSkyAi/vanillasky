import type {SceneTemplateProps} from './types';
import {editorialFont,fade} from './editorial-typography';

/** Short parallel thoughts, each given a quiet entrance and a shared reading hold. */
function CardsScene({variables,width,height,progress,motionProgress=progress,safeZone}:SceneTemplateProps){
 const items=(Array.isArray(variables.items)?variables.items:[]).filter((v):v is string=>typeof v==='string'&&!!v.trim()).slice(0,4);
 const u=Math.min(width,height),n=Math.max(1,items.length);
 const side=Math.max(width*.12,safeZone.left,safeZone.right),available=width-side*2;
 const top=Math.max(height*.18,safeZone.top),bottom=height-Math.max(height*.22,safeZone.bottom);
 const font=u*.057,slot=Math.min(u*.17,(bottom-top)/n),groupHeight=slot*n;
 const listTop=top+(bottom-top-groupHeight)/2;
 return <div data-template="cards" style={{position:'absolute',inset:0,overflow:'hidden',background:'#000',color:'#fff',fontFamily:editorialFont}}>
  {items.map((text,i)=><div data-template-item="cardList" key={i} style={{position:'absolute',left:side,top:listTop+i*slot,width:available,height:slot,display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',fontSize:Math.min(font,slot/(Math.max(1,Math.ceil(text.length*font*.52/available))*1.6)),fontWeight:500,lineHeight:1.22,letterSpacing:'-.025em',textWrap:'balance',overflowWrap:'anywhere',opacity:fade((motionProgress-.04-i*.14)/.18)}}>{text}</div>)}
 </div>;
}

export const CardsSceneTemplate = CardsScene;
