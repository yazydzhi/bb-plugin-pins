# Pins

Telegram-style pins for [BB](https://getbb.app) chats: pin messages, keep them
in a bar at the top of the thread, and find every pin in one place.

## Install

```sh
bb plugin install git:https://github.com/yazydzhi/bb-plugin-pins.git
```

Requires BB 0.50 or newer.

## Usage

- **Pin a message.** Hover a user or assistant message and click the pin icon
  in its action bar. The icon turns solid on pinned messages. Click it again
  to unpin. A thread can have as many pins as you like.
- **Pin a selection.** Select text inside an assistant reply and choose Pin in
  the selection menu. The pin shows and searches that excerpt instead of the
  whole message.
- **The bar.** Under the thread header, one pin is shown at a time with its
  role icon and a one-line snippet. With several pins you also get a counter
  (`2/5`) and up/down arrows that wrap around. Click the snippet to jump to the
  message; click the cross to unpin. A thread without pins has no bar.
- **The Pins tab.** Open it from the right panel's tab launcher, or run
  "Pins: Show pinned messages" in the command palette (Mod+Shift+P). It lists
  pins of all threads, newest first, with the thread title. Search filters by
  text and thread title; "This thread" limits the list. Click a pin to open its
  thread at the message; the trash icon removes it.

## Limits

- Text is stored per pin up to 20,000 characters; the list shows a short
  excerpt.
- Jumping to a message in another thread opens that thread and scrolls to the
  message. The thread must still exist; pins of deleted threads stay listed
  (marked "Deleted thread") but cannot be opened.
- Thread titles are saved with each pin and refreshed when the thread goes
  idle; the live title is used whenever the thread is in the sidebar.
- Pins belong to the BB installation, not to a project or a device account.

## Development

```sh
npm install
npm test            # vitest: storage, RPC, helpers, UI slots
npm run typecheck
npm run build       # bb plugin build -> dist/
```

`server.ts` owns the SQLite table (`bb.storage.database()` with append-only
migrations) and the RPC `list`, `toggle`, `add`, `remove`. `app.tsx` registers
the message action, the thread header row, the panel tab and the palette
command. Every write publishes a realtime signal on the `changed` channel, and
each surface refetches on it, so the bar, the panel and the filled pin icons
update live, including across windows.

## Credits

The way a pin jumps to a message (pushing the router history entry with
`searchMessageSeq` and replaying it with a popstate event), and the idea of
marking pinned messages with CSS keyed on `[data-timeline-row-id]`, come from
the [Bookmarks plugin](https://github.com/rebryk/bb-plugins/tree/main/bookmarks)
by Yurii Rebryk. The code here is a separate implementation.
