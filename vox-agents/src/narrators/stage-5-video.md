# Stage 5: Video — Stitch Final Output

## Contract

### Config

```typescript
interface VideoConfig extends NarratorStageConfig {
  type: "narrator-video";
  outputFormat?: "mp4" | "mkv";
  includeSubtitles?: boolean;
  includeGameAudio?: boolean; // mix in original game audio (attenuated)
}
```

### Input

- `workspace/scripts.json` (ScriptsOutput from Stage 3, for presentation order + episode refs)
- `workspace/audio/manifest.json` (AudioManifest from Stage 4)
- `workspace/episodes.json` (Episodes from Stage 1, for video file refs + offsets)
- Source video files from `workspace.getContext().recordingDir`

### Output: `workspace/output/final.mp4`

### No LLM — single implementation

Programmatic ffmpeg orchestration.

---

## Implementation

### Process

For each episode in presentation order:

1. **Resolve video source:** Look up episode in manifest by `(turn, playerID)` to get `sourceFile` and `offset`. Resolve full path via `recordingDir`.

2. **Extract video clip:** From source file starting at `offset`.
   - Duration = `max(episode.duration, audio.duration)`
   - If audio is longer than video: hold last frame (freeze frame)
   - If video is longer than audio: trim video to audio length (tight cuts)

3. **Mix audio:**
   - If `includeGameAudio`: mix original game audio at reduced volume (-12dB) under TTS
   - Otherwise: replace audio entirely with TTS

4. **Transitions:** Between episodes:
   - Hard cut (default, simpler, better for TikTok)
   - Crossfade (0.5s dissolve) — future enhancement

5. **Subtitles** (if `includeSubtitles`):
   - Generate SRT from script text + audio timing
   - Burn in via ffmpeg `subtitles` filter

6. **Concatenate** all clips into final output

### ffmpeg Strategy

Start with the **simple approach** (concat demuxer):

1. Pre-process each episode into a standalone clip with audio overlay:

   ```
   ffmpeg -ss <offset/1000> -i <sourceVideo> -i <ttsAudio> \
     -t <duration> -map 0:v -map 1:a -c:v copy -c:a aac \
     workspace/output/segments/t{turn}-p{playerID}.mp4
   ```

2. Write a concat list file (`workspace/output/concat.txt`):

   ```
   file 'segments/t42-p3.mp4'
   file 'segments/t50-p-1.mp4'
   ...
   ```

3. Concatenate:
   ```
   ffmpeg -f concat -safe 0 -i concat.txt -c copy workspace/output/final.mp4
   ```

**Future upgrade:** Use `filter_complex` for crossfades, picture-in-picture, text overlays when those features are needed.

### Game Audio Mixing

When `includeGameAudio` is true, step 1 becomes:

```
ffmpeg -ss <offset> -i <sourceVideo> -i <ttsAudio> \
  -t <duration> \
  -filter_complex "[0:a]volume=0.25[game];[game][1:a]amix=inputs=2:duration=longest[out]" \
  -map 0:v -map "[out]" -c:v copy -c:a aac \
  output.mp4
```

### Subtitle Generation

If enabled, generate an SRT file from the script text:

- Estimate timing by distributing words evenly across the audio duration
- Or use word-level timestamps if the TTS provider supplies them (provider-dependent)
- Burn in with: `-vf "subtitles=subs.srt:force_style='FontSize=24'"`
