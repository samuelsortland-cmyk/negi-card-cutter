# 🥬 Negi: the PF card cutter

Negi is an animated pixel-art AI assistant who cuts **Public Forum evidence cards** in your house format, double-checks them, and has them ready to paste into Word or Google Docs.

She runs on **Claude Code, the `claude` CLI, using your Claude login, with no API key**. The server even strips `ANTHROPIC_API_KEY` from her environment, so she always uses your subscription.

## Setup (one time)
1. Install **Node.js** (the LTS version) from https://nodejs.org.
2. Double-click **start.bat** (Windows) or **start.command** (Mac). Negi opens at http://localhost:4747.
3. Use the **🔌 Claude connection** box at the top:
   - **Install Claude Code**, only if she asks. A window opens and installs it.
   - **1. Connect Claude**: a window and your browser open. Sign in to Claude and click Authorize. Then copy the `sk-ant-…` code the window shows.
   - **2. Paste code**: Negi saves the code and tests it. A green **✔ Connected** means you're done for good.

The code is a login token for your Claude subscription, not an API key. It stays on your computer in `config.json`. Don't share that file.

## Cutting cards
1. The topic is pre-filled with the current resolution (Nov/Dec 2026): *European members of NATO should ratify the TPNW.*
2. Pick a **side**, how many cards, a **card length** (the default is **No limit**), and what the card should prove.
3. Optionally paste an article URL, or send a page from your browser with the bookmark (below).
4. Click **Cut it, Negi!**

### How she saves credits
- Claude **only searches** for sources. It doesn't download pages.
- **Negi downloads the articles herself**, for free, and numbers their paragraphs.
- Claude gets the text in **one call** and only replies with which paragraphs to use and which phrases to underline, highlight and bold.
- Negi then builds the card from the page's own words, so the text is **always word-for-word** and has **no length limit**.
- Checks for the author, date, title, publication and credentials are done by Negi's code against the page. Claude does a short web check only for credentials or dates the article doesn't state, and you can turn that off in Settings.
- The default model is **Sonnet**, which uses far fewer credits than Opus. You can pick **Haiku** for the cheapest option.

### Badges
**✔ VERIFIED** means everything matched the page. **⚠ REVIEW** means something couldn't be confirmed (hover over the ? marks to see what). **✘ FAILED CHECK** means something is missing. Open the source before reading a ⚠ or ✘ card in round.

## Card formatting
In **Settings → Card formatting** you can choose:
- the highlight color: bright green, **cyan/turquoise**, yellow, pink, gray or light blue
- the font: **Calibri**, Arial, Times New Roman, Cambria, Georgia, Garamond, Verdana or Helvetica
- the tag, read and small font sizes

The preview updates as you change them. Click **Save settings** to keep them. Copied and downloaded cards use your formatting.

## Using your browser
**✂️ Cut with Negi bookmark:** drag it from Settings to your bookmarks bar. On any article, click it. Negi receives the article text **straight from your browser**, so it works even on paywalled pages you're logged into and sites that block automatic downloads. You can highlight a passage first to focus her. Each card also has an **Open source** button.

## Auto-save and updates
- **Auto-save:** your cards, the cut form, and your settings save by themselves as you work. Cards are stored in the `data` folder with a backup each day (the last 14 days are kept), so clearing your browser won't lose them.
- **Automatic updates:** Negi checks for a new version when she starts and every 3 hours. With **Install updates automatically** on (Settings → Updates), she installs it when she isn't cutting and restarts herself. Otherwise a banner appears with an **Update now** button.
- Updates never touch `config.json` (your settings and Claude connection) or the `data` folder (your cards). If you edited a file an update replaces, such as the knowledge file, your version is kept next to it as `*.my-edits.*`.
- Every update is checked file by file before anything changes. If a new version fails to start, Negi switches back to the previous one by herself.

## Ask Negi
Use **Ask Negi** for quick PF coaching on weighing, turns, frontlines, and more.

## When the topic changes
Edit `knowledge/pf-knowledge.md`. It's the background Negi loads on every run: the resolution, the topic primer, PF jargon, the evidence rules, and the card format. Also change the Topic field in the app and click **Save settings**.

## Honesty rules Negi follows
She never invents authors, dates, quotes, or credentials. If she can't read a source, she says so instead of guessing. Still, **you're responsible for your evidence in round**: read the report and open the source before you read a ⚠ or ✘ card.
