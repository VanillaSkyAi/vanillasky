import type { SceneTemplateProps } from './types';
import { SceneBackground, getMediaBackgroundProps } from './scene-background';

/** The shared SDK media plane owns playback, decode readiness, and poster handoff. */
export function MediaScene({variables,style,width,height,progress,sceneDuration,isPlaying}:SceneTemplateProps) {
  return <div data-template="cinemaMedia" style={{width,height,position:'relative',overflow:'hidden'}}>
    <SceneBackground style={{...style,brand:{...style.brand,background:{type:'solid',color:'#000'}}}} width={width} height={height} progress={progress} sceneDuration={sceneDuration} {...getMediaBackgroundProps(variables)} mediaTreatment="none" backgroundEffect="none" isPlaying={isPlaying}/>
  </div>;
}
export const MediaSceneTemplate = MediaScene;
