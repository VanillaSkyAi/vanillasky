# Answer music

Music by **TAD**, from the [lofi Compilation on OpenGameArt](https://opengameart.org/content/lofi-compilation), published March 8, 2019. The collection is listed as [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/); see [LICENSE.txt](LICENSE.txt). The compositions are distributed under CC0, separately from the application's Apache license. CC0 permits copying, modification and redistribution, including commercial use.

TAD identifies these as original compositions made with GarageBand and Apple loops. This catalog includes complete compositions, not standalone loops. The source page's comments report automated claims involving **Morning Rain** and **A cup of tea**; those tracks remain excluded. Source and license were checked September 9, 2026. The license does not guarantee that automated claims cannot occur.

| Mood | Tracks |
| --- | --- |
| Calm | Countryside, Florist, Rainy Forest |
| Focused | Cue, Bartender |
| Upbeat | Cat Caffe, Oceanside |

The files were recovered from `VanillaSkyAi/vanillasky-site`, commit `704e41493ccc6b202c01224428c7e27fb49e1141`, under `public/audio-library/`. Original recordings remain in the external recovery archive; only the normalized versions are bundled here. The catalog lives in [music-catalog.ts](../../src/music-catalog.ts).

## Audio processing

Each recording was normalized with FFmpeg's two-pass `loudnorm` filter, targeting -18 LUFS integrated loudness, -3 dBTP true peak and 11 LU loudness range. Output is stereo, 44.1 kHz MP3 at 128 kbit/s. Metadata and embedded artwork were removed. The compositions were not cut or rearranged.

Measured encoded outputs are between -18.35 and -18.62 LUFS, with true peaks at or below -2.45 dBTP. [normalization.json](normalization.json) records each original hash, output hash, duration, filter settings, encoder version and measured levels. The extra peak headroom accounts for MP3 encoding overshoot. These measurements make track levels consistent; the final voice/music balance still requires listening with narration.

To reproduce, first measure the original with `loudnorm=I=-18:TP=-3:LRA=11:print_format=json`. Run the exact second-pass filter recorded for that file in the manifest with `-map 0:a:0 -map_metadata -1 -ar 44100 -ac 2 -codec:a libmp3lame -b:a 128k`. Finally measure the encoded MP3 again with the first-pass filter.
