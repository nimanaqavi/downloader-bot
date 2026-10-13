import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPrivateOrLocalIp, validateSafeUrl } from "../src/utils/ssrf.js";

describe("SSRF and IP Validation", () => {
  it("detects private IPv4 addresses correctly", () => {
    assert.equal(isPrivateOrLocalIp("127.0.0.1"), true);
    assert.equal(isPrivateOrLocalIp("127.255.255.255"), true);
    assert.equal(isPrivateOrLocalIp("10.0.0.5"), true);
    assert.equal(isPrivateOrLocalIp("172.16.0.1"), true);
    assert.equal(isPrivateOrLocalIp("172.31.255.255"), true);
    assert.equal(isPrivateOrLocalIp("192.168.1.1"), true);
    assert.equal(isPrivateOrLocalIp("169.254.169.254"), true);
    assert.equal(isPrivateOrLocalIp("100.64.0.1"), true);
    assert.equal(isPrivateOrLocalIp("0.0.0.0"), true);
  });

  it("detects public IPv4 addresses as safe", () => {
    assert.equal(isPrivateOrLocalIp("8.8.8.8"), false);
    assert.equal(isPrivateOrLocalIp("1.1.1.1"), false);
    assert.equal(isPrivateOrLocalIp("142.250.190.46"), false);
  });

  it("detects private and link-local IPv6 addresses", () => {
    assert.equal(isPrivateOrLocalIp("::1"), true);
    assert.equal(isPrivateOrLocalIp("fe80::1"), true);
    assert.equal(isPrivateOrLocalIp("fc00::1"), true);
    assert.equal(isPrivateOrLocalIp("fd12:3456::1"), true);
  });

  it("rejects non-HTTP protocols", async () => {
    const resFtp = await validateSafeUrl("ftp://example.com/video.mp4");
    assert.equal(resFtp.valid, false);

    const resFile = await validateSafeUrl("file:///etc/passwd");
    assert.equal(resFile.valid, false);

    const resData = await validateSafeUrl("data:text/plain;base64,SGVsbG8=");
    assert.equal(resData.valid, false);
  });

  it("rejects localhost and private IPs in URLs", async () => {
    const resLocalhost = await validateSafeUrl("http://localhost:3000/api");
    assert.equal(resLocalhost.valid, false);

    const resIp = await validateSafeUrl("http://127.0.0.1:8080/secret");
    assert.equal(resIp.valid, false);

    const resLinkLocal = await validateSafeUrl("http://169.254.169.254/latest/meta-data");
    assert.equal(resLinkLocal.valid, false);
  });

  it("accepts legitimate public web URLs", async () => {
    const resYt = await validateSafeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(resYt.valid, true);
    assert.equal(resYt.url?.hostname, "www.youtube.com");
  });
});
