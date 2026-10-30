# Roxy

Roxy is a Windows desktop music player built with Electron. It searches the Soulseek network through **slskd**, downloads selected audio files, and plays them locally. It also supports importing playlists from Spotify.

> Roxy is an independent community project. Soulseek, slskd, Spotify, Electron, and their respective trademarks and services belong to their owners.

## Download Roxy

<a href="https://github.com/unfair1k/roxy-soulseek/releases/latest"><img src="https://img.shields.io/badge/Download-Roxy%20for%20Windows-2ea44f?style=for-the-badge&logo=windows" alt="Download Roxy for Windows"></a>

**How to download and install:**

1. Click the **Download Roxy for Windows** button above.
2. On the Releases page, open the latest version.
3. Under **Assets**, download the Windows installer named `Roxy-Setup.exe`.
4. Once the download is complete, double-click the installer and follow the on-screen instructions.
5. Launch **Roxy** from the Desktop shortcut or Start Menu.

You do not need to install Node.js to use the packaged application. If Windows displays a security warning, make sure you downloaded the installer from this official repository before choosing whether to continue.

> If no installer is listed under **Assets**, a Windows installer has not been published yet. Check back after a release is available.

## Features

- Sign in with a Soulseek username and password. If the account does not exist, Soulseek may create it during the first connection.
- Automatically downloads and starts the Windows x64 release of slskd on first use.
- Search Soulseek for music. Results are ranked by relevance, with one row per song instead of one row per peer.
- Lossless first: within each song, Roxy picks the best copy (FLAC/WAV, highest bit depth and sample rate, a peer that can send it right away).
- Near-instant playback: each track is requested from several peers at once, and the next tracks in the queue are downloaded while the current one plays (see [How playback works](#how-playback-works)).
- Playback queue with play, pause, previous, next, seek, and volume controls.
- Library: save tracks with the heart button, browse recently played tracks, and create and manage local playlists.
- Bounded download cache: tracks you only listened to are cleaned up automatically; saved and playlist tracks are kept.
- Synced lyrics in the center of the window, with the album cover spinning when no lyrics are available, and album covers in every track list and playlist.
- Jam: listen together with other Roxy users, synchronized through Soulseek private messages.
- Import public Spotify playlists and albums by pasting a link (no login), or import your own playlists and liked songs through Spotify's authorization flow.
- Choose a custom background and adjust the glass/transparency appearance.
- Optionally remember the Soulseek login on the device.

## Requirements

### To run the packaged application

- Windows 10 or Windows 11 (64-bit).
- An internet connection for the first slskd download and Soulseek/Spotify services.
- A Soulseek account.
- Windows PowerShell, which is used by the first-run slskd extraction process.

### To run from source or build the installer

- Windows 10 or Windows 11 (64-bit).
- Node.js (LTS recommended), which includes npm.
- An internet connection to install npm dependencies and download Electron.

## Run from source

1. Install Node.js from <https://nodejs.org/>.
2. Clone or download this repository.
3. Open a terminal in the repository root (the folder containing `package.json`).
4. Install dependencies:

   ```bash
   npm install
   ```

5. Start Roxy:

   ```bash
   npm start
   ```

You can also double-click `abrir-roxy.bat` on Windows. The script checks for Node.js, installs dependencies when needed, and launches the app.

## First launch

1. Start Roxy.
2. Enter your Soulseek username and password.
3. Leave **Keep me connected** enabled if you want Roxy to remember the login on this device.
4. On first use, Roxy downloads the latest Windows x64 slskd release from the official slskd GitHub Releases page, extracts it under the user's application data folder, writes the local slskd configuration, and starts the service.
5. Allow Roxy/slskd through Windows Firewall if Windows displays a permission prompt.

Roxy connects to the local slskd web API at `http://localhost:5030`. The API key is generated locally by Roxy and written to the slskd configuration. Soulseek downloads are stored in the slskd downloads directory under the user's local application data folder.

If slskd is already running with a different API configuration, close that instance and restart Roxy.

## Build the Windows installer

From the repository root, run:

```bash
npm install
npm run dist
```

Or double-click `gerar-instalador.bat`.

Electron Builder is configured to create a Windows NSIS installer. The output is written to `dist/`. The installer is configured for per-user installation and creates Start Menu and Desktop shortcuts.

**Build asset note:** the current build configuration references `build/icon.ico` as the Windows installer icon and `build/icon.png` as a packaged resource. Make sure both files exist in the repository before building. If they are missing, add the icon assets to the `build/` directory.

## Using Roxy

The left panel has four tabs:

| Tab | What it shows |
| --- | --- |
| **Buscar** (Search) | Soulseek search. Each row is one song; the detail line shows format and resolution (for example `FLAC 24/96`), size, and how many peers share it. |
| **Músicas** (Saved) | Tracks saved with the heart (♡/♥) button, available from search results, the queue, playlists, and history. |
| **Recentes** (Recent) | The last 50 tracks played, most recent first. **Limpar** clears the list. |
| **Playlists** | Local playlists with their covers, Spotify link import, and the signed-in Spotify import. Imported playlists keep their Spotify cover; other playlists show a mosaic of their first four tracks. |

## Search ranking

Soulseek returns every matching file from every peer, so a popular song can come back hundreds of times. Roxy groups and ranks the results before showing them:

1. **Grouping.** Files are grouped into one song when their normalized title matches (ignoring track numbers and words that already appear in the artist/album folder names) and their durations are within 5 seconds of each other.
2. **Relevance.** Each group is scored by how many query terms appear in the title or in the surrounding folders, plus a popularity bonus based on how many peers share it. The original studio recording is usually the most shared copy.
3. **Alternate versions.** Live recordings, remixes, acoustic versions, karaoke, covers, tributes, and dated bootleg folders are pushed down unless the query contains the matching word (for example, searching for `creep acoustic`).
4. **Best copy.** Inside a group, Roxy plays the best copy: lossless formats first, then peers with a free upload slot and an empty queue, then the highest bit depth and sample rate, then upload speed.

## How playback works

Soulseek is a file-sharing network: it transfers whole files and has no streaming mode. slskd also keeps a file locked while it downloads, so Roxy cannot start playing a track before its download completes. In practice, most of the waiting time comes from the remote peer's queue and connection setup rather than the transfer itself, so Roxy hides that wait in two ways:

- **Download race.** When a track starts, the same file (same format and resolution) is requested from up to three peers at once. Roxy plays whichever download completes first and cancels the others.
- **Prefetch.** While a track plays, the next two queue entries are downloaded in the background. Spotify-imported entries are matched on Soulseek first. When playback reaches them, they start immediately.

Measured on a typical connection with an album playlist:

| Situation | Time to start |
| --- | --- |
| First track (Soulseek lookup and download of a 110 MB 24-bit/96 kHz FLAC) | about 29 s |
| Track already in the cache | under 1 s |
| Next tracks after prefetch | about 0.1 s |

When no peer can send a lossless copy right away, Roxy waits in a peer's upload queue rather than falling back to a lower quality. The status line shows which peer is serving the file and, when available, your position in that peer's queue.

slskd allows only one search at a time, so Roxy runs searches one after another. A manual search may wait for a background prefetch lookup to finish (up to about 20 seconds).

## Lyrics and artwork

The center of the window shows the lyrics of the current track. Synced lyrics highlight the current line and keep it centered as the track plays; clicking a line seeks to it. When a track has no lyrics, its cover is shown spinning in the center instead.

- **Track details.** For FLAC files, Roxy reads the artist, title and embedded front cover from the file's metadata. Otherwise it uses the artist and title matched by the artwork lookup, then the file name.
- **Lyrics sources.** [LRCLIB](https://lrclib.net) first (matched by artist, title and duration), then [NetEase Music](https://music.163.com) as a fallback when LRCLIB is unavailable or has no synced lyrics. Neither requires an API key.
- **Lyrics cache.** Results are cached under the app's user data folder (`lyrics/`). A "no lyrics" result is cached only when every source answered, so a temporary outage is retried on the next play.
- **Artwork.** Covers come from the embedded FLAC picture when present, otherwise from the [Deezer search API](https://developers.deezer.com/api/search). They are shown in track lists, the queue, the player bar, and the center of the window.

When the queue is open in a window narrower than 1180 px, the center is hidden because there is not enough room.

## Jam (listen together)

A jam lets other Roxy users listen to what you play, at the same position. There is no server: commands travel as Soulseek private messages through slskd, and every participant downloads the track from Soulseek on their own machine.

### Hosting

1. Click **Jam** in the header.
2. Type the other person's Soulseek username and click **Convidar**. Your own username is shown next to the Jam button; click it to copy it.
3. The panel lists who was invited and who joined. Everything you play, pause, seek, or skip is sent to the guests.
4. **Encerrar a jam** ends the session for everyone.

### Joining

When someone invites you, a card appears at the bottom of the window. Click **Entrar** to join or **Recusar** to decline. While you are in a jam, Roxy plays the host's track, prefetches the next ones, follows play and pause, and corrects the position when it drifts more than 2 seconds. **Sair da jam** leaves the session.

### How it works and limitations

- **Messages.** Each command is a private message with a `ROXYJAM1` prefix followed by JSON. Roxy only reads and acknowledges messages with that prefix; other conversations are left unread. Invites start with a readable sentence so that a person opening the conversation in another Soulseek client understands it.
- **Everyone needs Roxy.** Guests using another Soulseek client only see the invite text.
- **Sync accuracy.** Messages take around one second to arrive, and the host sends its state on every action and every 15 seconds. Expect guests to be within 1 to 2 seconds of the host. The position is computed from the host's clock (the Soulseek server clock can be minutes off), so both computers should have their time set automatically.
- **First track.** When the host changes track, guests need a few seconds to download it; their playback starts at the host's current position once the download completes.
- **Invite expiry.** Invites older than 10 minutes are ignored, for example when the app is opened long after the invite was sent.

## Library and download cache

Downloaded files behave like a streaming cache:

- Files that are **saved** (heart) or belong to a **playlist** are kept permanently.
- Every other downloaded file is part of a 5 GB cache. After each track starts playing, Roxy deletes the least recently played cached files until the cache fits within the limit. Playing a file marks it as recently used.

The limit is defined by `CACHE_LIMIT` in `main.js`. Files that were downloaded before the cache was introduced count as cache files.

## Spotify import

Roxy offers two ways to import from Spotify. In both cases, only track information (title, artists, duration) is imported; Soulseek remains the source used to find and download playable audio. Each imported track is looked up on Soulseek the first time it is played or prefetched.

### From a link (no login)

Paste a public playlist or album link (for example `https://open.spotify.com/playlist/...` or `https://open.spotify.com/album/...`) into the **Playlists** tab and click **Importar**. Roxy reads the track list from Spotify's public embed page.

The embed page lists at most 100 tracks. For longer playlists, use the signed-in import.

### Your playlists and liked songs (login)

**Minhas playlists do Spotify** uses Spotify's OAuth Authorization Code with PKCE flow. The app opens Spotify's authorization page in the browser and listens for the local callback at `http://127.0.0.1:8898/callback`. No Spotify client secret is embedded in the app.

While the Spotify developer app is in development mode, Spotify only accepts the app owner and accounts added under **User Management** in the Spotify developer dashboard.

## Project structure

```text
roxy-soulseek/
├── main.js                         # Electron main process: settings, slskd, cache, Spotify and IPC
├── preload.js                      # Secure bridge between renderer and main process
├── package.json                    # Dependencies, scripts and Electron Builder config
├── package-lock.json               # Locked npm dependency versions
├── abrir-roxy.bat                  # Install dependencies if needed and launch Roxy
├── gerar-instalador.bat            # Build the Windows installer
├── README.md
├── CHANGELOG.md                    # Notable changes per release
├── build/
│   ├── icon.ico                    # Windows installer icon (required by current config)
│   └── icon.png                    # Packaged app icon resource
└── renderer/
    ├── index.html                  # Main player interface
    ├── styles.css                  # Main interface styling
    ├── app.js                      # Queue, playback UI, library, history, playlists, lyrics stage and prefetch
    ├── jam.js                      # Jam protocol over Soulseek private messages
    ├── login.html                  # Soulseek login screen
    ├── login.css
    ├── login.js
    ├── providers/
    │   └── soulseek.js             # Soulseek search ranking, download race and audio provider
    ├── background.jpg
    ├── login-photo.jpg
    ├── dance.webp
    └── icon.png
```

## Technologies and upstream projects

- **Electron** — desktop application runtime: <https://www.electronjs.org/>
- **Electron Builder** — Windows installer packaging: <https://www.electron.build/>
- **slskd** — local Soulseek client and Web API. Roxy downloads the official Windows x64 release at first launch: <https://github.com/slskd/slskd>
- **Soulseek** — peer-to-peer music sharing network: <https://www.slsknet.org/>
- **Spotify Web API** — playlist metadata and OAuth authorization: <https://developer.spotify.com/documentation/web-api>
- **Spotify embed pages** — public playlist and album track lists for link import: <https://developer.spotify.com/documentation/embeds>
- **LRCLIB** — synced lyrics: <https://lrclib.net>
- **NetEase Music** — fallback synced lyrics: <https://music.163.com>
- **Deezer API** — album artwork lookup: <https://developers.deezer.com/api>

The npm dependencies and exact resolved versions are recorded in `package.json` and `package-lock.json`.

## Customization

- Login screen photo: replace `renderer/login-photo.jpg`.
- Default player background: replace `renderer/background.jpg`. A background can also be selected from inside Roxy.
- Header/player icon: replace `renderer/icon.png`.
- Download animation: replace `renderer/dance.webp`.
- Windows application/installer icons: replace `build/icon.ico` and `build/icon.png`.

Keep the same filenames and paths unless you also update the references in the source and build configuration.

## Troubleshooting

### Roxy cannot connect to Soulseek

- Check your internet connection and Soulseek credentials.
- Make sure Windows Firewall has not blocked Roxy or slskd.
- If another slskd instance is already using port `5030`, close it and restart Roxy.
- If the local slskd configuration was changed manually, check the API key and local API settings.

### The search works but playback does not start

- Wait for the download to finish. The status line under the track title shows the download state, including the peer's upload queue position when you are waiting in it.
- Check that the download folder exists and has enough free disk space.
- Try another result; the remote user may be offline or the file may be unavailable.
- Roxy supports common audio formats including MP3, FLAC, OGG, OPUS, WAV, M4A, and AAC. Actual playback also depends on the Chromium/Electron media codecs available in the installed build.

### Spotify import does not open or complete

- For link imports, make sure the playlist is public and the link points to a playlist or an album.
- For the signed-in import, check your internet connection and sign in to Spotify in the browser.
- Allow the local callback on `127.0.0.1:8898`.
- If port `8898` is already in use, close the application using it and retry.

### Installer build fails

- Confirm Node.js and npm are installed.
- Run `npm install` again from the repository root.
- Confirm the `build/icon.ico` and `build/icon.png` files exist.
- Check the terminal output for the first reported error.

## Data and privacy

Roxy stores its settings in Electron's per-user application data directory. The app uses Electron's `safeStorage` when available to protect saved credentials and the local slskd API key. If operating-system encryption is unavailable, the current implementation falls back to base64 encoding, which is **not encryption**. Do not use the remember-login option on a shared or untrusted Windows account.

Jam sessions exchange private messages with the usernames you invite or accept; those messages contain track file names, titles, and playback positions.

To show lyrics and artwork, Roxy sends the artist and title of the playing track (and of listed tracks, for covers) to LRCLIB, NetEase Music and Deezer. No account or personal data is sent.

Music files are downloaded from other Soulseek users to the local slskd downloads directory. Files that are neither saved nor part of a playlist are deleted automatically once the 5 GB cache limit is exceeded (see [Library and download cache](#library-and-download-cache)). Saved tracks, recent history, and playlists are stored in the app's local storage on this device. Spotify authorization is handled through the system browser and the local PKCE callback.

## License

No license file is currently included. Unless a license is added to this repository, all rights to the Roxy source code remain with its copyright holder.