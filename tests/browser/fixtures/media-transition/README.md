# Continuous playback fixture

`waterfall-hold.webm` is a VP8, 360 × 640, 30 fps, five-second derivative of
`waterfall.mp4`, showing the same waterfall footage. Its source attribution is
https://www.pexels.com/video/serene-waterfall-flowing-through-forest-37625941/.

Reproduce it from the retained MP4:

```sh
ffmpeg -i waterfall.mp4 -an -c:v libvpx -b:v 2M -crf 10 -pix_fmt yuv420p waterfall-hold.webm
```

The continuous-narration and sustained decoder-identity proofs select VP8
derivatives on Linux WebKit. First-frame tests retain their original MP4 assets. Linux WebKit
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

The decoder-identity test uses `waterfall-hold.webm`, `tram.webm`, and
`sunflowers.webm` on Linux WebKit only. The latter two are produced with the same
command above, substituting the corresponding MP4 filename. The test still
requires the same video element through every cut and a full loop, and now
requires at least three increasing presented-frame times spanning one second
on the same scene and decoder. Retained proof JSON
records the codec and platform. macOS WebKit continues using all original H264
files; the MP4 sources are retained. A separate native fault-injection test stops
frame delivery and verifies bounded chapter recovery without stopping the player.

PR93 run `34060349041` retained the native H264 limitation: the original run
reported waiting at 0.267 seconds in the third clip; its retry at 0.269 seconds
in the second clip. Both had complete local 200 media responses. The bounded
stall recovery correctly removed that failed decoder, so its successor could
not satisfy an assertion intended for healthy, continuously decoding footage.
