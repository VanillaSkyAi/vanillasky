import React from "react";
import { createRoot } from "react-dom/client";
import { SuggestionCards } from "../../../src/video-chat/suggestion-cards";
import "../../../styles/video-chat.css";
import clip from "./media-transition/waterfall.mp4?url";
const prompts = ["Show me the next practical step", "Explain how to practise this movement safely at home and recognise the most common mistakes before they become a habit", "Tell this story from a different point of view", "Compare the alternatives and help me choose a useful starting point"];
const welcome = new URLSearchParams(location.search).has("welcome");
createRoot(document.getElementById("root")!).render(<div className="vanillasky-video-chat"><div className="stage-area"><div className="stage"><section className={welcome ? "welcome" : "ending"}><div className={welcome ? "welcome-body" : "ending-body"}><p className="ending-label">Keep exploring</p><SuggestionCards label="Follow-up prompts" suggestions={prompts.map(prompt => ({prompt, media: {type: "video", url: clip}}))} onAsk={() => {}} /></div></section></div></div><div className="panel"><div className="panel-inner"><div className="line-row">That is the complete answer.</div><form className="composer"><input aria-label="Ask a follow-up" placeholder="Ask a follow-up" /></form></div></div></div>);
