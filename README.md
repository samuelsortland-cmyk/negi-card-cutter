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
The bar above your cards controls how they look and paste:
- **Font:** Calibri, Times New Roman, Arial, Cambria, Aptos, Georgia, Garamond, Book Antiqua, Century Gothic, Verdana, Tahoma or Helvetica
- **Highlight:** bright green, **cyan**, yellow, pink, blue, red, light blue, orange or gray, plus **＋** to pick any color
- **Sizes:** tag, read text and small text, in points

Changes apply to every card right away and save automatically.

## Constructive or rebuttal
Pick **Speech** at the top of the cut form:
- **Constructive:** case cards with a full warrant, link and impact. The highlighting is aimed at about 25–90 words (roughly 8–25 seconds read aloud), or up to 110 words with **No limit** length.
- **Rebuttal:** quick answers to the other team. Fill in **Opponent's argument you're answering**, and optionally choose a **Response type**: turn, no link, non-unique, mitigation, impact defense or evidence indict. The tag starts with the label (for example "TURN — …"), and the highlighting is aimed at 12–45 words (about 4–12 seconds).

### Reading-length check
Before you get a card, Negi counts the highlighted words and checks that they read smoothly, without strings of 1–2 word fragments. If a card is too long, too short or choppy, she re-highlights just that card once, automatically. Each card shows its read time (🕒 ~11s read), and the double-check report includes **Reading length** and **Reads smoothly**.

## Prep writer
In the **📝 Prep writer** panel, Negi writes four kinds of prep in the same format and voice as your own prep docs:
- **Frontlines:** give your argument and their responses (one per line). For each response you get 2–3 answers (no link, non-unique, turn, mitigation, or "they misread our case") as "FL:" bullets. Tick **cut a fresh card for each response** and she also cuts a rebuttal card for every response (up to 4) and puts it under the answers.
- **Extensions:** one "Extend: X" paragraph per argument that walks the link chain to the impact. Summary versions are 3–5 sentences, final focus versions 2–3.
- **Weighing:** "Weighing: X" templates with (a)/(b) lines like "- Timeframe + Probability: … This outweighs because […]". Pick the mechanisms or let her choose. Tick **Fill in** to have her write the comparison against their impacts.
- **Ballot directives:** the first-look line, if-then lines, why to prefer your weighing, what they dropped, and a closing vote line.

**Using your cards:** open **Use my saved cards** and tick the ones to draw from. Negi only names authors from cards you tick, and anything she'd need but doesn't have stays as a [stat] or [card] blank.

**Voice check:** every result is checked for AI-sounding phrases ("moreover", "crucial", "delve" and similar), notes to herself, card names that aren't in your cards, and extensions that run long. If any of those turn up, she rewrites it once automatically. Each result shows **✔ SOUNDS LIKE YOU** or a note on what to check. Your prep auto-saves with daily backups, like your cards.

## Choosing how recent the evidence is
Use **Published** in the cut form: *2026 only*, *2025 only*, *2025 or newer*, *2024 or newer*, *Last 6 months*, *Last 12 months* (the default), *Any time*, or **Custom years** (for example 2023 to 2026).
- Searches look only in that range.
- Downloaded articles dated outside it are skipped before Claude reads them, which saves credits.
- Every card gets an **In your date range** check, and any card outside the range is removed.

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
