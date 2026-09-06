import { useState } from "react";
import { createRoot } from "react-dom/client";
import { VideoChat } from "../../src/react";
import "../../styles/video-chat.css";
import "./style.css";
declare const __CHAT_LIVE_ENDPOINT__: string;
const scenarios = ["ready", "slow", "miss", "decode-error", "speech-error", "allowance", "throttled"];
const intents = ["explanation", "story", "comedy", "imagination", "practical", "golf"];
function App() {
  const [intent, setIntent] = useState("explanation");
  const [scenario, setScenario] = useState("ready");
  const [live, setLive] = useState(false);
  const [timing, setTiming] = useState("");
  const endpoint = live ? __CHAT_LIVE_ENDPOINT__ : `/__chat/offline?intent=${intent}&scenario=${scenario}`;
  return <><aside className="dev-toolbar">
    <strong>{live ? "LIVE · app-owned endpoint · uses allowance" : "OFFLINE · SDK source · deterministic fixtures"}</strong>
    {!live && <><label>Intent <select value={intent} onChange={event => setIntent(event.target.value)}>{intents.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Condition <select value={scenario} onChange={event => setScenario(event.target.value)}>{scenarios.map(value => <option key={value}>{value}</option>)}</select></label></>}
    {__CHAT_LIVE_ENDPOINT__ && <button onClick={() => setLive(value => !value)}>{live ? "Return to offline" : "Connect live endpoint (uses allowance)"}</button>}
    <span>{live ? "Host authorization and limits apply." : "Local waterfall + recorded timing cue; not proof of model quality."} {timing}</span>
  </aside><main className="dev-chat"><VideoChat key={endpoint} options={{endpoint, credentials: live ? "include" : "same-origin", onFirstFrame: metric => setTiming(`First body frame: ${metric.timeToFirstFrameMs} ms`)}} /></main></>;
}
createRoot(document.getElementById("root")!).render(<App />);
