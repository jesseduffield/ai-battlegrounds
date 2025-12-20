type SoundName =
  | "pickup"
  | "equip"
  | "attack"
  | "miss"
  | "death"
  | "unlock"
  | "drop"
  | "search"
  | "trap";

const audioContext = new (window.AudioContext ||
  (window as unknown as { webkitAudioContext: typeof AudioContext })
    .webkitAudioContext)();

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume: number = 0.3,
  attack: number = 0.01,
  decay: number = 0.1
): void {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

  gainNode.gain.setValueAtTime(0, audioContext.currentTime);
  gainNode.gain.linearRampToValueAtTime(
    volume,
    audioContext.currentTime + attack
  );
  gainNode.gain.linearRampToValueAtTime(
    volume * 0.7,
    audioContext.currentTime + attack + decay
  );
  gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + duration);
}

function playNoise(
  duration: number,
  volume: number = 0.2,
  highpass: number = 1000
): void {
  const bufferSize = audioContext.sampleRate * duration;
  const buffer = audioContext.createBuffer(
    1,
    bufferSize,
    audioContext.sampleRate
  );
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = audioContext.createBufferSource();
  noise.buffer = buffer;

  const filter = audioContext.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = highpass;

  const gainNode = audioContext.createGain();
  gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration);

  noise.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioContext.destination);

  noise.start();
}

const soundEffects: Record<SoundName, () => void> = {
  pickup: () => {
    playTone(600, 0.1, "sine", 0.2);
    setTimeout(() => playTone(800, 0.1, "sine", 0.2), 50);
  },

  equip: () => {
    playTone(200, 0.15, "sawtooth", 0.15);
    setTimeout(() => playTone(400, 0.1, "sawtooth", 0.2), 80);
  },

  attack: () => {
    playNoise(0.15, 0.3, 500);
    playTone(150, 0.1, "sawtooth", 0.3);
  },

  miss: () => {
    playNoise(0.1, 0.15, 2000);
    playTone(200, 0.15, "sine", 0.1);
  },

  death: () => {
    playTone(300, 0.3, "sawtooth", 0.4);
    setTimeout(() => playTone(200, 0.3, "sawtooth", 0.3), 150);
    setTimeout(() => playTone(100, 0.5, "sawtooth", 0.2), 300);
  },

  unlock: () => {
    playTone(400, 0.1, "square", 0.15);
    setTimeout(() => playTone(500, 0.1, "square", 0.15), 100);
    setTimeout(() => playTone(700, 0.15, "square", 0.2), 200);
  },

  drop: () => {
    playTone(400, 0.1, "sine", 0.15);
    setTimeout(() => playTone(300, 0.1, "sine", 0.1), 80);
  },

  search: () => {
    playNoise(0.1, 0.1, 3000);
    setTimeout(() => playNoise(0.08, 0.08, 4000), 100);
  },

  trap: () => {
    playTone(800, 0.05, "square", 0.4);
    playNoise(0.2, 0.3, 1000);
    setTimeout(() => playTone(600, 0.1, "square", 0.3), 100);
  },
};

export function playSound(name: SoundName): void {
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  soundEffects[name]?.();
}

export function playSoundForEvent(sound: string | undefined): void {
  if (sound && sound in soundEffects) {
    playSound(sound as SoundName);
  }
}
