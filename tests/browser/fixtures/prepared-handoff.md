# Bounded mobile preparation

This candidate starts from SDK 0.10.7 (`825a112`) and makes bounded preparation
the default for compatible mobile templates. It is not a physical-device
safety result. Custom video registries keep conservative single-layer cuts.

Compatible mobile template registries use the existing keyed local scene
layers from their initial render. Only the active and immediate next scene
are mounted; the next element is retained when it becomes active. The next
scene mounts as soon as it is available, rather than 1.2 seconds before its
cut. The mobile detached video warmer remains disabled. No byte cache or
additional provider request path is introduced.

The fixture repeats the exact prerecorded paragraph three times, once per
scene, using the real generated-voice adapter and audio clock. This isolates
complete narration and cut timing; it is not an editorial quality example.
H264 is exercised on macOS; the existing VP8 derivatives are selected on
Linux WebKit because its H264 stall is documented separately.

Run the bounded offline verification:

```sh
npx playwright test tests/browser/prepared-handoff.spec.ts --project=webkit --workers=1
```

Evidence is written to `prepared-handoff.json` in each Playwright result.
It records Range requests, element identities, presented frame media times,
active surfaces, narration cuts, and native utterance endings. The healthy
case requires an actual frame from the incoming node before that same node
is promoted, three full utterance endings, no mid-utterance pauses, at most
two connected sources, and both handoff and outgoing-to-incoming frame gaps
of at most 200 ms. Late-resource and true-stall controls retain bounded
waiting and authored chapter recovery.

Observed macOS WebKit results: the unchanged baseline waited 3,035 ms at the
first cold cut with 1.5-second Range responses. The prepared candidate's
outgoing-to-incoming gaps were 34 ms and 18 ms, with more than one second of
sustained moving frames per scene. A nine-second initial-resource delay
missed the preparation window and produced gaps of 2,209 ms and 350 ms;
all speech still completed after actual visual readiness. An injected stall
after both audio and video advanced recovered to the authored chapter.

Remaining device validation: measure repeated cuts, memory pressure and
background/foreground behavior on real iPhone/iPad hardware at production
media resolutions. Desktop WebKit with an iPhone user agent cannot establish
mobile decoder memory safety. The bound concerns mounted source-owning
elements; native decoder release can be asynchronous. Lifecycle unit tests
verify pause/resume retention, prepared-node promotion, backward seek and
source release on unmount. Native fixtures retain sustained motion and full
audio assertions across cuts.
