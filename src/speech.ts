import OpenAI from "openai";
import { Character } from "./types";

let openai: OpenAI | null = null;

const JUDGE_VOICE = "onyx";
const MALE_VOICES = ["echo", "fable", "ash"] as const;
const FEMALE_VOICES = ["nova", "shimmer", "alloy", "sage", "coral"] as const;

const characterVoiceMap = new Map<string, string>();
const genderVoiceIndex = {
  male: 0,
  female: 0,
};

function getVoiceForCharacter(character: Character): string {
  if (!characterVoiceMap.has(character.name)) {
    let voice: string;
    if (character.gender === "male") {
      voice = MALE_VOICES[genderVoiceIndex.male % MALE_VOICES.length];
      genderVoiceIndex.male++;
    } else {
      voice = FEMALE_VOICES[genderVoiceIndex.female % FEMALE_VOICES.length];
      genderVoiceIndex.female++;
    }
    characterVoiceMap.set(character.name, voice);
  }
  return characterVoiceMap.get(character.name)!;
}

let currentAudio: HTMLAudioElement | null = null;
let currentAudioPromise: Promise<void> | null = null;

export function initializeSpeech(apiKey: string): void {
  openai = new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
}

export function isSpeechPlaying(): boolean {
  return currentAudio !== null;
}

export async function waitForSpeech(): Promise<void> {
  if (currentAudioPromise) {
    await currentAudioPromise;
  }
}

export async function speakText(
  text: string,
  character: Character
): Promise<void> {
  if (!openai) {
    console.warn("Speech not initialized");
    return;
  }

  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    currentAudioPromise = null;
  }

  const voice = getVoiceForCharacter(character);

  try {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice as any,
      input: text,
      speed: 1.5,
    });

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    currentAudio = new Audio(url);

    currentAudioPromise = new Promise<void>((resolve) => {
      currentAudio!.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        currentAudioPromise = null;
        resolve();
      };
      currentAudio!.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        currentAudioPromise = null;
        resolve();
      };
    });

    currentAudio.play();

    await currentAudioPromise;
  } catch (err) {
    console.error("TTS error:", err);
  }
}

export async function speakJudgeVerdict(text: string): Promise<void> {
  if (!openai) {
    console.warn("Speech not initialized");
    return;
  }

  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    currentAudioPromise = null;
  }

  try {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: JUDGE_VOICE,
      input: text,
      speed: 1.3,
    });

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    currentAudio = new Audio(url);

    currentAudioPromise = new Promise<void>((resolve) => {
      currentAudio!.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        currentAudioPromise = null;
        resolve();
      };
      currentAudio!.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        currentAudioPromise = null;
        resolve();
      };
    });

    currentAudio.play();

    await currentAudioPromise;
  } catch (err) {
    console.error("TTS error:", err);
  }
}

export function stopSpeech(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    currentAudioPromise = null;
  }
}
