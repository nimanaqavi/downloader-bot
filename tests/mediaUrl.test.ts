import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMediaUrl } from "../src/utils/mediaUrl.js";

describe("Universal Media URL Router", () => {
  it("correctly identifies YouTube URLs", async () => {
    const res1 = await parseMediaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(res1?.platform, "youtube");
    assert.equal(res1?.platformName, "یوتیوب");

    const res2 = await parseMediaUrl("https://youtu.be/dQw4w9WgXcQ");
    assert.equal(res2?.platform, "youtube");

    const res3 = await parseMediaUrl("https://youtube.com/shorts/abcd1234efg");
    assert.equal(res3?.platform, "youtube");
  });

  it("correctly identifies Instagram URLs", async () => {
    const res1 = await parseMediaUrl("https://www.instagram.com/p/C-123456/");
    assert.equal(res1?.platform, "instagram");
    assert.equal(res1?.platformName, "اینستاگرام");

    const res2 = await parseMediaUrl("https://instagram.com/reel/C-xyz789/");
    assert.equal(res2?.platform, "instagram");
  });

  it("correctly identifies TikTok, Twitter, Facebook, Reddit, SoundCloud", async () => {
    const tiktok = await parseMediaUrl("https://www.tiktok.com/@user/video/123456789");
    assert.equal(tiktok?.platform, "tiktok");

    const twitter = await parseMediaUrl("https://x.com/jack/status/20");
    assert.equal(twitter?.platform, "twitter");

    const fb = await parseMediaUrl("https://fb.watch/abcd1234/");
    assert.equal(fb?.platform, "facebook");

    const reddit = await parseMediaUrl("https://www.reddit.com/r/videos/comments/123456/test_video/");
    assert.equal(reddit?.platform, "reddit");

    const sc = await parseMediaUrl("https://soundcloud.com/artist/track-name");
    assert.equal(sc?.platform, "soundcloud");

    const spotify = await parseMediaUrl("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
    assert.equal(spotify?.platform, "spotify");
    assert.equal(spotify?.platformName, "اسپاتیفای");
  });

  it("routes unknown domains to generic platform", async () => {
    const generic = await parseMediaUrl("https://archive.org/details/test-video");
    assert.equal(generic?.platform, "generic");
    assert.equal(generic?.platformName, "وب");
  });

  it("detects audio prefix mp3", async () => {
    const audioReq = await parseMediaUrl("mp3 https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(audioReq?.isAudioRequested, true);
    assert.equal(audioReq?.platform, "youtube");

    const audioSlash = await parseMediaUrl("/mp3 https://soundcloud.com/artist/track");
    assert.equal(audioSlash?.isAudioRequested, true);
    assert.equal(audioSlash?.platform, "soundcloud");
  });

  it("rejects malicious, SSRF, or invalid URLs", async () => {
    const invalidText = await parseMediaUrl("just random text with no url");
    assert.equal(invalidText, null);

    const localIp = await parseMediaUrl("http://192.168.1.50/video.mp4");
    assert.equal(localIp, null);

    const localhost = await parseMediaUrl("http://localhost:3000/download");
    assert.equal(localhost, null);
  });
});
