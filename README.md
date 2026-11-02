# Wildcard Watch (Unofficial)

A personal fan page that shows who in The Wildcard Club is live, what they sound like, and their streams since the member reveal. It is not affiliated with The Wildcard Club, STUDIO TANGRAM, HYBE, or any member.

## How it works

GitHub Actions runs `scripts/update.py` every 10 minutes, saves the results in `data/`, and deploys to GitHub Pages.

| File | Contents |
| --- | --- |
| `data/members.json` | Members, channels, songs, and collab-matching names (edited by hand) |
| `data/live.json` | Live and upcoming streams (generated) |
| `data/streams.json` | Stream archive (generated, grows over time) |
| `data/avatars.json` | X profile image URLs (refreshed daily) |

UI text lives in `STRINGS` in `assets/app.js`, in English and Japanese.

## Setup

1. Create a public repository and push to `main`.
2. In Settings > Pages, set Source to **GitHub Actions**.
3. In Settings > Secrets and variables > Actions, add:
   - `YOUTUBE_API_KEY`: enable YouTube Data API v3 in the [Google Cloud Console](https://console.cloud.google.com/) and create a key.
   - `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`: register an app in the [Twitch Developer Console](https://dev.twitch.tv/console/apps). `http://localhost` works as the OAuth redirect URL.
4. Run **Update and deploy** from the Actions tab.

A platform without credentials is skipped, and the page says so.

## Notes

- Scheduled GitHub runs can be delayed. The page shows when it last checked.
- The page is set to `noindex`. Remove that line from `index.html` to appear in search engines.
- CHZZK (Terri) uses public data that needs no key but has no published spec, so it may break without notice. A failure does not affect the other platforms.
- X profile image URLs come from the public [FxTwitter](https://github.com/FixTweet/FxTwitter) service.

## Local check

```sh
python -m unittest discover scripts
python -m http.server 8000
```

## Fonts

Petaluma Script (Steinberg) and Montserrat are in `assets/fonts/`. Noto Sans JP loads from Google Fonts. All use the SIL Open Font License 1.1.
