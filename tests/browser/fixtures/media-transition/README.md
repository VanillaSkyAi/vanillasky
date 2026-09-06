# Continuous hold fixture

`waterfall-hold.webm` is a VP8, 360 × 640, 30 fps, five-second derivative of
`waterfall.mp4`, showing the same waterfall footage. Its source attribution is
https://www.pexels.com/video/serene-waterfall-flowing-through-forest-37625941/.

Reproduce it from the retained MP4:

```sh
ffmpeg -i waterfall.mp4 -an -c:v libvpx -b:v 2M -crf 10 -pix_fmt yuv420p waterfall-hold.webm
```

Only the continuous final-frame hold test selects this derivative. All existing
MP4 transition and first-frame tests retain their original assets. Linux WebKit
26.5 in Playwright 1.62 can stop advancing fully buffered native H264 MP4 video
around 0.27 seconds, including a bare video without the SDK. A baseline H264
re-encode also reproduced that failure. The VP8 fixture keeps the complete
five-second playback and stable final-frame assertions deterministic without
claiming continuous H264 playback is verified on Linux WebKit.

`paragraph.mp3` is a local MP3 transcode of the same offline `paragraph.wav` fixture (24 kHz, 128 kbps), used to exercise Safari generated-speech handoff. No production-generated audio or provider call is included.
