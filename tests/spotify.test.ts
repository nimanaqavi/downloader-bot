import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSpotifyUrl,
  selectBestCandidate,
  type SearchCandidate
} from "../src/services/spotify.js";
import { normalizeMediaUrl } from "../src/utils/urlNormalizer.js";

describe("Spotify URL Normalization and Candidate Selection", () => {
  it("normalizes Spotify track URLs by stripping intl-xx and tracking query parameters", async () => {
    const raw = "https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT?si=abc1234&utm_source=copy-link";
    const parsed = await parseSpotifyUrl(raw);

    assert.equal(parsed.type, "track");
    assert.equal(parsed.trackId, "4cOdK2wGLETKBW3PvgPWqT");
    assert.equal(parsed.url, "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
  });

  it("identifies album, playlist, and podcast links as unsupported types", async () => {
    const album = await parseSpotifyUrl("https://open.spotify.com/intl-es/album/4SZko61aMnmgvYeFHV15dg?si=xyz");
    assert.equal(album.type, "album");

    const playlist = await parseSpotifyUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
    assert.equal(playlist.type, "playlist");

    const podcast = await parseSpotifyUrl("https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5");
    assert.equal(podcast.type, "podcast");
  });

  it("selects the candidate closest to target duration (within ±5s) and avoids unwanted remixes", () => {
    const candidates: SearchCandidate[] = [
      {
        id: "1",
        title: "Ed Sheeran - Shape of You (Official Dance Club Remix)",
        duration: 215,
        url: "https://youtube.com/watch?v=1",
        provider: "youtube"
      },
      {
        id: "2",
        title: "Ed Sheeran - Shape of You (Official Music Video)",
        duration: 233, // Target is 234 -> diff 1s
        url: "https://youtube.com/watch?v=2",
        provider: "youtube"
      },
      {
        id: "3",
        title: "Ed Sheeran - Shape of You (Live at Wembley)",
        duration: 290,
        url: "https://youtube.com/watch?v=3",
        provider: "youtube"
      }
    ];

    const best = selectBestCandidate(candidates, "Shape of You", "Ed Sheeran", 234);
    assert.ok(best);
    assert.equal(best?.id, "2");
    assert.equal(best?.title, "Ed Sheeran - Shape of You (Official Music Video)");
  });

  it("handles fallback to SoundCloud candidate when provided in candidate pool", () => {
    const soundcloudCandidates: SearchCandidate[] = [
      {
        id: "sc1",
        title: "Mohsen Yeganeh - Behet Ghol Midam",
        duration: 210,
        url: "https://soundcloud.com/user/behet-ghol-midam",
        provider: "soundcloud"
      }
    ];

    const best = selectBestCandidate(soundcloudCandidates, "Behet Ghol Midam", "Mohsen Yeganeh", 212);
    assert.ok(best);
    assert.equal(best?.provider, "soundcloud");
    assert.equal(best?.id, "sc1");
  });
});
