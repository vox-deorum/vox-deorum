# Stage 4: Voice — Generate TTS Audio

## Contract

### Config

```typescript
interface VoiceConfig extends NarratorStageConfig {
  type: "narrator-voice";
  tts: TTSConfig;
}

interface TTSConfig {
  provider: string; // e.g., 'elevenlabs', 'openai', 'local'
  voice: string; // provider-specific voice ID
  speed?: number; // speaking rate multiplier
  [key: string]: unknown; // provider-specific options
}
```

### Input

- `workspace/scripts.json` (ScriptsOutput from Stage 3)

### Output: `workspace/audio/` directory

```typescript
// workspace/audio/manifest.json
interface AudioOutput {
  episodes: AudioEntry[];
  audioPath: string; // folder for storing audio files
}

interface AudioEntry {
  turn: number;
  playerID: number;
  file: string; // filename in audio/ dir
  duration: number; // actual spoken duration from TTS output
  wordCount: number;
  estimatedDuration: number; // from script estimate
}
```

### No LLM — single implementation

Direct TTS API calls.

---

## Implementation

### TTSProvider Interface

```typescript
interface TTSProvider {
  /** Generate speech audio from text. Returns raw audio buffer. */
  generate(text: string, config: TTSConfig): Promise<Buffer>;
  /** Output audio format */
  format: "mp3" | "wav" | "opus";
}
```

Concrete implementations registered by provider name. The session instantiates the configured provider at startup.

### Process

For each `ScriptedEpisode` in scripts.json (in presentation order):

1. Call `provider.generate(episode.script, config.tts)`
2. Write to `workspace/audio/t{turn}-p{playerID}.{format}`
3. Probe the output file for actual duration (ffprobe or audio metadata parsing)
4. Record in `manifest.json`

### Duration Validation

If actual TTS duration differs from estimated by more than 20%, log a warning. The user can re-run Stage 3 to adjust scripts, then re-run this stage.

### Provider Implementations (deferred)

The `TTSProvider` interface is designed for pluggability. Concrete providers to implement later:

- **ElevenLabs** — highest quality, most expressive voices
- **OpenAI TTS** — simpler API, good baseline
- **Azure Speech** — enterprise option
- **Local** (e.g., Coqui TTS) — for testing without API costs
