// Run on macOS with the already-installed Samantha voice and ffmpeg. No downloads.
import { readFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'darwin') throw new Error('Regeneration requires macOS say; checked-in MP3s work on any platform.');
const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const temporary = mkdtempSync(join(tmpdir(), 'vanillasky-fixture-speech-'));
const input = join(temporary, 'speech.aiff');
try {
  for (const line of manifest.utterances) {
    execFileSync('/usr/bin/say', ['-v', manifest.voice, '-r', String(manifest.wordsPerMinute), '-o', input, line.text]);
    execFileSync(process.env.FFMPEG ?? 'ffmpeg', ['-v', 'error', '-i', input,
      '-map_metadata', '-1', '-ar', '24000', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k',
      '-y', fileURLToPath(new URL(line.file, import.meta.url))]);
    unlinkSync(input);
  }
} finally {
  try { unlinkSync(input); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  rmdirSync(temporary);
}
console.log(`Generated ${manifest.utterances.length} local spoken fixtures.`);
