# Continuous playback fixture

`waterfall-hold.webm` is a VP8, 360 × 640, 30 fps, five-second derivative of
`waterfall.mp4`, showing the same waterfall footage. Its source attribution is
https://www.pexels.com/video/serene-waterfall-flowing-through-forest-37625941/.

Reproduce it from the retained MP4:

```sh
ffmpeg -i waterfall.mp4 -an -c:v libvpx -b:v 2M -crf 10 -pix_fmt yuv420p waterfall-hold.webm
```

The continuous-narration proof selects this derivative on Linux WebKit. Existing
MP4 transition and first-frame tests retain their original assets. Linux WebKit
26.5 in Playwright 1.62 can stop advancing fully buffered native H264 MP4 video
around 0.27 seconds, including a bare video without the SDK. A baseline H264
re-encode also reproduced that failure. The VP8 fixture keeps the complete
five-second motion and bounded recovery assertions deterministic without
claiming continuous H264 playback is verified on Linux WebKit.

`paragraph.mp3` is a local MP3 transcode of the same offline `paragraph.wav` fixture (24 kHz, 128 kbps), used to exercise Safari generated-speech handoff. No production-generated audio or provider call is included.

The delayed-speech regression waits inside the page with `waitForFunction`. Do not poll through repeated `page.evaluate` calls while waiting for gesture expiry: those protocol calls renewed activation in WebKit and masked the original `NotAllowedError`. Read telemetry only after the in-page completion signal.

The continuous-narration fixture uses the same offline paragraph in full over
moving footage. `waterfall-short.mp4` is its deliberately insufficient 1.5-second
H264 excerpt; `waterfall-audio.mp4` adds a synthetic 220 Hz AAC tone to the full
clip to verify native audible playback without repeating dialogue. Their WebM
variants use VP8 and Opus for Linux WebKit, following the documented native H264
limitation above. macOS WebKit, Chromium and Firefox exercise the H264/AAC files.
`activation-cue.wav` is a synthetic 150 ms 440 Hz cue that models the immediate
opening audio which activates Safari's reused audio element before a delayed
body. It is not part of the narrated answer. The test requires both that cue
and the complete original paragraph to reach their real `ended` events.

These are playback mechanics fixtures, not examples of model-generated creative
quality. Browser recordings are silent; the exact paragraph remains separately
available in `paragraph.wav`. No provider calls or generated media are involved.
