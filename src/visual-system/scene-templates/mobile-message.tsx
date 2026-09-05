import type { SceneTemplateProps } from './types';
import { spring } from '../motion';

import {MediaScene} from './cinema-media';
import {editorialFont} from './editorial-typography';

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Refines the original floating NotificationCard; the message arrives as one native alert. */
function NotificationScene(props: SceneTemplateProps) {
  const {variables,progress,motionProgress=progress,sceneDuration=6,width,height,safeZone}=props;
  const message = String(variables.message ?? '');
  const app = String(variables.app ?? 'Messages');
  const unit = Math.min(width, height);
  const cardWidth = Math.min(width * .88, unit * 1.12, width - safeZone.left - safeZone.right - unit * .06);
  const inset = unit * .038;
  const elapsed = clamp(motionProgress) * Math.max(2, Math.min(sceneDuration, 8));
  const entrance = clamp((elapsed - .18) / .82);
  const arrival = entrance >= 1 ? 1 : spring(entrance, {damping:22,stiffness:220});
  const opacity = clamp((elapsed - .18) / .08);
  const contentWidth = cardWidth - inset * 2;
  const messageSize = unit * (message.length > 100 ? .038 : .043);
  const longestWord = Math.max(1, ...message.split(/\s+/).map(word => word.length));
  const fittedMessageSize = Math.min(messageSize, contentWidth / (longestWord * .57));
  const bannerTop = Math.max(safeZone.top, height * .08) + unit * .025;
  const travel = bannerTop + unit * .65;
  const iconSize = unit * .049;
  return <div data-template="notification" style={{position: 'absolute', inset: 0, overflow: 'hidden', background:'var(--vanillasky-template-surface, #000)', fontFamily:editorialFont}}>
    <MediaScene {...props}/>
    <div aria-hidden="true" style={{position:"absolute",inset:0,background:"rgba(0,0,0,.16)"}}/>
    <div data-notification-card="true" style={{position: 'absolute', left: (width - cardWidth) / 2, top: bannerTop, width: cardWidth, boxSizing: 'border-box', transform: `translateY(${-(1-arrival)*travel}px) scale(${.985+arrival*.015})`, opacity, transformOrigin: '50% 0%', padding: inset, borderRadius: unit * .042, background:'rgba(245,247,250,.64)', backdropFilter:`blur(${unit*.034}px) saturate(135%)`, WebkitBackdropFilter:`blur(${unit*.034}px) saturate(135%)`, border: `${unit * .001}px solid rgba(255,255,255,.72)`, boxShadow:`0 ${unit*.018}px ${unit*.065}px rgba(0,0,0,.2), inset 0 ${unit*.001}px 0 rgba(255,255,255,.8)`, color: '#202025'}}>
      <div data-notification-header="true" style={{display: 'flex', alignItems: 'center', gap: unit * .014, marginBottom: unit * .024}}>
        <div style={{width: iconSize, height: iconSize, borderRadius: iconSize * .25, display: 'grid', placeItems: 'center', background: 'linear-gradient(#5bd978, #25b749)', flexShrink: 0}}>
          <svg viewBox="0 0 40 40" width={iconSize * .78} height={iconSize * .78} aria-hidden="true"><path d="M34 18c0 7-6 12-14 12-2 0-4 0-6-1l-7 3 2-7c-2-2-3-4-3-7C6 11 12 6 20 6s14 5 14 12Z" fill="white" /></svg>
        </div>
        <div style={{fontSize: unit * .029, fontWeight: 500, color: '#5b565f', minWidth: 0, overflowWrap: 'anywhere'}}>{app}</div>
      </div>
      <div style={{fontSize: fittedMessageSize, lineHeight: 1.26, letterSpacing: '-.016em', overflowWrap: 'anywhere'}}>{message}</div>
    </div>
  </div>;
}

export const NotificationSceneTemplate = NotificationScene;
