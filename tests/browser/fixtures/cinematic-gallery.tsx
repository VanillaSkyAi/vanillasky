import {createRoot} from 'react-dom/client';
import {VideoFrame} from '../../../src/player/video-frame';
import {createRenderTemplateRegistry} from '../../../src/visual-system/catalog/internal';
import {listTemplates} from '../../../src/visual-system/scene-templates/registry';
import {VIDEO_SCHEMA_VERSION,type Video} from '../../../src/protocol/types';
const params=new URLSearchParams(location.search);
const id=params.get('template')??'chapterTitle';
const portrait=params.get('orientation')==='portrait';
const examples:Record<string,Record<string,unknown>>={
 cinemaMedia:{mediaUrl:'/tests/browser/fixtures/media-transition/waterfall.jpg',mediaType:'photo'},
 chapterTitle:{title:'A quieter world'},
 focusCards:{items:['Listen closely','Notice the pattern','Make room for change']},
 editorialTimeline:{events:[{label:'A small beginning'},{label:'A change takes shape'},{label:'A new direction'}]},
 mobileMessage:{message:'Are you free for a walk?',app:'Messages',mediaUrl:'/tests/browser/fixtures/media-transition/waterfall.jpg',mediaType:'photo'},
 comparison:{leftText:'More noise',rightText:'More clarity',leftLabel:'Before',rightLabel:'After'},
 quote:{quote:'Look closely. There is always more to see.',attribution:'Illustrative quotation'},
 keyFigure:{value:'42%',label:'Illustrative figure'},
};
const templates=listTemplates();
const width=portrait?390:1280,height=portrait?694:720;
const video:Video={schemaVersion:VIDEO_SCHEMA_VERSION,orientation:portrait?'portrait':'landscape',style:{},scenes:[{id,templateId:id,variables:examples[id],timing:{fixedDuration:8}}]};
createRoot(document.getElementById('root')!).render(<VideoFrame config={video} time={5} width={width} height={height} kit={createRenderTemplateRegistry({templates:[...templates]})}/>);
