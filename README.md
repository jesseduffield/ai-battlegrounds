# AI Battlegrounds

Play [here](https://jesseduffield.com/ai-battlegrounds/)

<img width="1728" height="1001" alt="image" src="https://github.com/user-attachments/assets/08b3a78b-3fe7-4b32-b6d8-3f6932de2884" />

https://github.com/user-attachments/assets/827eb59a-ed9a-4328-aa25-a674a1ac5ce8

It's about time we put LLM's in an ACTUAL arena. In this turn-based 2D grid game, AI agents explore, fight, cooperate, and deceive, to survive.

If you're looking for a new way to test the agentic abilities of LLM's, or if you want to design some torturous Squid-Game-esque scenarios that pit agents against eachother, this is the place to do it.

## Features

- **AI-driven characters** Powered by OpenAI's models (BYO API key)
- **Imperfect information** - Characters only know what they've seen or heard
- **Blood contracts** - Agents can sign contracts with eachother to enforce agreements, and if either party violates the contract, they will be struck dead by the Great Judge.
- **Level editor** - Come up with your own contrived situations to see how the AI's behave.
- **Enter the game yourself** - Play as a character and see if you can manipulate the AI's to achieve your goals.

Guys, the sky is the limit with this stuff. You really can create some crazy shit in this system.

## Screenshots

<img width="1728" height="989" alt="image" src="https://github.com/user-attachments/assets/6ee4ac85-4a66-495f-b7b3-5ab989ba38fd" />

<img width="1728" height="996" alt="image" src="https://github.com/user-attachments/assets/cef81f9d-070a-4964-9dea-24f16b2ebebf" />


## Quick Start

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in your browser.

## Work in progress

Although this is certainly at MVP stage, it's very much a work in progress.

There's a bunch of stuff I want to add:
* Fix all the bugs
* Game recordings and replay.
* Balance things better (maybe there shouldn't be so much capacity for talking in each turn cos it slows things down)
* Support for more models (anthropic, gemini, etc)
* More items, effects, interactions, etc
* How cool would it be if you could cast a spell on somebody which lowers their intelligence for a couple turns by switching them to a weaker model.
* Much larger scope like have a self-sustaining town of people with jobs and an economy and criminals that the police need to deal with.
* My vision for this is to end up being VERY life-like in terms of the behaviours that the characters can exhibit, even if it's in a context where there's spells and stuff. Game of thrones would be the best analogy with all of the messed up stuff that happens in that show.

## How much agency is too much?

I don't really like the idea of having an AI dungeon master meddling with things in the game: I much prefer a game with iron-clad constraints where the emergent complexity comes from the agents acting within those constraints. With that said, for certain features to be possible, you need to get a God-like agent involved like the Great Judge who judges the outcome of blood contracts. Similarly you can apply effects to items which invoke a God AI to apply the effect; that allows in the level editor for you to just describe in words what an effect does and it will actually happen (provided that the God AI can make it happen with the actions available to them).

I considered an approach where absolutely everything was agentic like if you go to open a door, the door decides whether it actually opens or not, but I'll let somebody else make that game.

## Ethics?

Note that in the prompt I'm telling the agent that they're PLAYING a character in a game, not that they actually are in the described situation, for what it's worth. So if AI is conscious there should be no more suffering than that inflicted on a person playing dungeons and dragons.

## Donate

I blew 500 bucks on Opus 4.5 writing the code for this, so PLEASE consider donating [here](https://github.com/jesseduffield)
