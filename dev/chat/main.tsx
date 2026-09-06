import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { VideoChat } from "../../src/react";
import "../../styles/video-chat.css";
import "./style.css";
import { createChatDiagnostics, type DiagnosticRow } from "./diagnostics";
declare const __CHAT_LIVE_ENDPOINT__: string;
const scenarios = ["ready", "slow", "miss", "decode-error", "speech-error", "allowance", "throttled"];
const intents = ["explanation", "story", "comedy", "imagination", "practical", "golf"];
function App() {
  const [intent, setIntent] = useState("explanation");
  const [scenario, setScenario] = useState("ready");
  const [live, setLive] = useState(false);
  const [rows, setRows] = useState<DiagnosticRow[]>([]);
  const endpoint = live ? __CHAT_LIVE_ENDPOINT__ : `/__chat/offline?intent=${intent}&scenario=${scenario}`;
  const diagnostics = useMemo(() => createChatDiagnostics(setRows), [endpoint]);
  const fetcher = useMemo(() => diagnostics.wrapFetch(fetch), [diagnostics]);
  useEffect(() => {setRows([]); return () => diagnostics.dispose();}, [diagnostics]);
  const surface = rows.find(row => row.phase === "body surface");
  const footage = rows.find(row => row.phase === "moving footage");
  return <><aside className="dev-toolbar">
    <strong>{live ? "LIVE · app-owned endpoint · uses allowance" : "OFFLINE · SDK source · deterministic fixtures"}</strong>
    {!live && <><label>Intent <select value={intent} onChange={event => setIntent(event.target.value)}>{intents.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Condition <select value={scenario} onChange={event => setScenario(event.target.value)}>{scenarios.map(value => <option key={value}>{value}</option>)}</select></label></>}
    {__CHAT_LIVE_ENDPOINT__ && <button onClick={() => setLive(value => !value)}>{live ? "Return to offline" : "Connect live endpoint (uses allowance)"}</button>}
    <span>{live ? "Host authorization and limits apply." : "Local waterfall + matching spoken fixtures; not live model output."} {surface && `Body surface: ${surface.elapsedMs} ms. `}{footage && `Moving footage: ${footage.elapsedMs} ms.`}</span>
    <details><summary>Safe phase log ({rows.length})</summary><ol>{rows.map((row, index) => <li key={index}>{row.elapsedMs} ms · {row.phase}{row.durationMs !== undefined && ` · ${row.durationMs} ms duration`}{row.status && ` · HTTP ${row.status}`}</li>)}</ol></details>
  </aside><main className="dev-chat"><VideoChat key={endpoint} options={{endpoint, credentials: live ? "include" : "same-origin", fetcher, onPlaybackMetric: diagnostics.playback}} /></main></>;
}
createRoot(document.getElementById("root")!).render(<App />);
