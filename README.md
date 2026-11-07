# Trackers Plus

Project Σ's bundled **Trackers**, with one addition: **the Chat Assistant can read them.** Ask it about a tracker, check a progress bar, or have it write a lorebook entry from what a tracker holds.

Everything else works as Trackers does: your own model updates each tracker after every reply, and the chat's prompt carries them as of the message it's answering. Requires Project Σ with extension API 2.7.

## Use it

1. Settings > Extensions: switch **Trackers Plus** on.
2. In a chat, open the **Trackers Plus** window, and add a tracker from the examples or your own.
3. Ask the Chat Assistant about it. It reads the same tracker text as the story's model, as of the chat's newest message.

## Coming from the bundled Trackers

Trackers Plus keeps its own data, because an extension can't read another's. To bring a definition across, export it in Trackers' editor and import it in this one. The states already recorded in old chats don't move; a tracker starts fresh in Trackers Plus.

Both can be on and nothing breaks, but if a chat keeps a tracker in each, the model reads both and your model updates both.

In a preset, the macro here is `{{trackers_plus}}`.

## What it reads, writes and sends

Everything Trackers does, in its own tables (`x_trackersplus_defs`, `x_trackersplus_chats`, `x_trackersplus_states`). The addition only adds text to a request the Assistant was already making, in a chat with a tracker that holds something.

## Credit

A fork of the Trackers extension bundled with Project Σ, copyright (c) 2026 Sillyanonymous, under the MIT license in `LICENSE`. The changes here are the Assistant hook, the names of the tables, macro and window, and the tests.

## Develop

```
node --test          # SIGMA_DIR=<Project Σ checkout> when it is not ../../../../ProjectSigma-main
```
