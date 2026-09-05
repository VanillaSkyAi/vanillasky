import type { SceneTemplateProps } from './types';

import {editorialFont,fade as ease} from './editorial-typography';

/** A quiet chapter beat: fade in, read, fade to black. */
function TitleScene({ variables, width, height, progress }: SceneTemplateProps) {
  const title = String(variables.title ?? 'A different perspective');
  const unit = Math.min(width, height);
  const opacity = ease(progress / .22) * (1 - ease((progress - .76) / .24));
  return <div data-template="title" data-title-treatment="quiet-fade" style={{position:'absolute',inset:0,background:'#000',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center'}}>
    <div data-title-composition="centered" style={{width:'76%',textAlign:'center',opacity,fontFamily:editorialFont,fontWeight:500,fontSize:unit * .068,lineHeight:1.18,letterSpacing:'-.025em',textWrap:'balance',overflowWrap:'anywhere'}}>{title}</div>
  </div>;
}

export const TitleSceneTemplate = TitleScene;
