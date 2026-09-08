import type { SceneTemplateProps } from './types';

const editorialFont = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Roboto, Arial, sans-serif';
function ease(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/** A quiet chapter beat: fade in, read, fade to black. */
function TitleScene({ variables, width, height, progress, motionProgress }: SceneTemplateProps) {
  const title = String(variables.title ?? 'A different perspective');
  const unit = Math.min(width, height);
  const presentation = motionProgress ?? progress;
  const opacity = ease(presentation / .22) * (1 - ease((presentation - .76) / .24));
  return <div data-template="title" data-title-treatment="quiet-fade" style={{position:'absolute',inset:0,background:'#000',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center'}}>
    <div data-title-composition="centered" style={{width:'76%',textAlign:'center',opacity,fontFamily:editorialFont,fontWeight:500,fontSize:unit * .068,lineHeight:1.18,letterSpacing:'-.025em',textWrap:'balance',overflowWrap:'anywhere'}}>{title}</div>
  </div>;
}

export const TitleSceneTemplate = TitleScene;
