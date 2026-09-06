import type {CSSProperties, ReactNode} from 'react';
import type {SceneTemplateProps} from './types';
import {SceneBackground, getMediaBackgroundProps, hasSceneMedia} from './scene-background';
import {editorialFont} from './editorial-typography';

/** Optional host-resolved footage, sharing the player's decode and playback plane. */
export function EditorialSurface({children,template,...props}:SceneTemplateProps & {children:ReactNode;template:string}) {
 const {variables,style,width,height,progress,sceneDuration,isPlaying}=props;
 const overMedia=hasSceneMedia(variables),u=Math.min(width,height);
 const surface:CSSProperties={position:'absolute',inset:0,overflow:'hidden',background:overMedia?'var(--vanillasky-template-surface, #000)':'#000',fontFamily:editorialFont,color:'#fff',
  // Two soft, scale-aware shadows preserve local contrast without outlining type.
  textShadow:overMedia?`0 ${u*.002}px ${u*.008}px rgba(0,0,0,.65), 0 ${u*.006}px ${u*.016}px rgba(0,0,0,.4)`:undefined};
 return <div data-template={template} style={surface}>
  {overMedia&&<SceneBackground style={style} width={width} height={height} progress={progress} sceneDuration={sceneDuration} {...getMediaBackgroundProps(variables)} mediaTreatment="cinematic" textAnchor="center" backgroundEffect="none" isPlaying={isPlaying}/>}
  {children}
 </div>;
}
