import OpenAI from "openai";

let openai: OpenAI | null = null;

const VOICES = [
  "nova",
  "shimmer",
  "echo",
  "onyx",
  "fable",
  "alloy",
  "ash",
  "sage",
  "coral",
] as const;

const characterVoiceMap = new Map<string, (typeof VOICES)[number]>();
let nextVoiceIndex = 0;

function getVoiceForCharacter(name: string): (typeof VOICES)[number] {
  if (!characterVoiceMap.has(name)) {
    characterVoiceMap.set(name, VOICES[nextVoiceIndex % VOICES.length]);
    nextVoiceIndex++;
  }
  return characterVoiceMap.get(name)!;
}

let currentAudio: HTMLAudioElement | null = null;

export function initializeSpeech(apiKey: string): void {
  openai = new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
}

export async function speakText(
  text: string,
  characterName: string
): Promise<void> {
  if (!openai) {
    console.warn("Speech not initialized");
    return;
  }

  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  const voice = getVoiceForCharacter(characterName);

  try {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice,
      input: text,
      speed: 1.5,
    });

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    currentAudio = new Audio(url);
    currentAudio.play();

    currentAudio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
    };
  } catch (err) {
    console.error("TTS error:", err);
  }
}

export function stopSpeech(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}
