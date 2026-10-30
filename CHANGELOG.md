# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Search results are grouped into one row per song and ranked by relevance and popularity. Alternate versions (live, remix, acoustic, karaoke, covers, tributes) rank lower unless the query asks for them.
- The search detail line shows bit depth and sample rate (for example `FLAC 24/96`) and the number of peers sharing each song.
- Download race: a track is requested from up to three peers with the same format and resolution, and the first completed download is played.
- Prefetch of the next two queue entries while a track is playing.
- Saved tracks (heart button) in a new **Músicas** tab.
- Recently played tracks (last 50) in a new **Recentes** tab, with a button to clear the history.
- A 5 GB download cache that removes the least recently played files that are neither saved nor in a playlist.
- Import of public Spotify playlists and albums by link, without signing in (up to 100 tracks per link).
- Synced lyrics in the center of the window from LRCLIB, with NetEase Music as a fallback. The current line is highlighted and clickable to seek; lyrics are cached on disk.
- The album cover spins in the center of the window when a track has no lyrics.
- Album covers in track lists, the queue and the player bar, from the embedded FLAC picture or the Deezer search API.
- FLAC metadata (artist, title, embedded cover) is read to look up lyrics with clean tags.
- Jam sessions: invite other Roxy users by Soulseek username to listen together. Track, position and play state are synchronized through Soulseek private messages.
- Playlist covers: the Spotify cover for imported playlists, or a mosaic of the first four track covers.
- The signed-in Soulseek username is shown in the header and can be copied with a click.
- Loading status (search, peer queue, download progress) under the cover in the center of the window.

### Changed

- Within a song, playback prefers lossless files, then peers with a free upload slot, then higher resolution, then upload speed.
- Searches run one at a time, because slskd rejects concurrent searches with HTTP 429.
- The signed-in Spotify import button is now labeled **Minhas playlists do Spotify**.
- Download status messages name the peer serving the file and the position in its upload queue.
- Starting playback no longer opens the queue drawer, so the lyrics stay visible.
- The default window size is 1280x760 (was 1080x720).

### Fixed

- Pressing play, the space bar, or a media key while a new track was downloading resumed the previous track.
- The previous track kept playing while a Spotify-imported track was being looked up on Soulseek.
- The loading status in the player bar was overwritten when the cover arrived.
- The lyrics and cover were off-center when the queue was closed.

## [0.4.0]

- Baseline release imported from the original repository.
