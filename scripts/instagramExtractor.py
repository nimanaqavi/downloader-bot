#!/usr/bin/env python3
import sys
import json
import os

# Ensure local or server yt-dlp path is in sys.path
for path in ['/home/telbot/bin/yt-dlp', os.path.expanduser('~/bin/yt-dlp')]:
    if os.path.exists(path) and path not in sys.path:
        sys.path.insert(0, path)

try:
    import yt_dlp
except ImportError:
    pass

def embed_photos(url):
    """Photo-only posts carry no video, so yt-dlp refuses to download them.
    The public embed page still lists the CDN image URLs and needs no cookies."""
    import re
    import urllib.request

    m = re.search(r'/(?:p|reel|tv)/([A-Za-z0-9_-]+)', url)
    if not m:
        return []
    shortcode = m.group(1)
    req = urllib.request.Request(
        'https://www.instagram.com/p/%s/embed/captioned/' % shortcode,
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'},
    )
    try:
        page = urllib.request.urlopen(req, timeout=20).read().decode('utf-8', 'ignore')
    except Exception:
        return []

    items, seen = [], set()
    pattern = "https://[^\"']+?\\.jpg[^\"']*"
    for u in re.findall(pattern, page):
        u = u.replace('&amp;', '&').strip()
        if 's100x100' in u or '/v/t51.2885-19/' in u:
            continue  # profile avatar
        key = u.split('?')[0]
        if key in seen:
            continue
        seen.add(key)
        items.append({'type': 'photo', 'url': u, 'id': shortcode})
    return items


MAX_HEIGHT = 720  # Instagram reels: cap at 720p so a single post stays small


def pick_video(formats):
    """Best format at or below 720p; falls back to the smallest we can get."""
    vids = [f for f in formats if f.get('vcodec') and f.get('vcodec') != 'none']
    if not vids:
        return None
    under = [f for f in vids if (f.get('height') or 0) <= MAX_HEIGHT]
    pool = under or vids
    return max(pool, key=lambda f: ((f.get('height') or 0), (f.get('tbr') or 0)))


def pick_audio(formats):
    """Audio-only track (photo posts with music expose one, video posts have it separate)."""
    auds = [f for f in formats
            if f.get('acodec') and f.get('acodec') != 'none'
            and (not f.get('vcodec') or f.get('vcodec') == 'none')]
    if not auds:
        return None
    return max(auds, key=lambda f: (f.get('abr') or f.get('tbr') or 0))


def extract(url, cookies_path=None):
    opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'force_ipv4': True,
        'extract_flat': False
    }
    if cookies_path and os.path.exists(cookies_path):
        opts['cookiefile'] = cookies_path

    try:
        ydl = yt_dlp.YoutubeDL(opts)
        info = ydl.extract_info(url, download=False, process=False)
    except Exception as e:
        if 'no video in this post' in str(e).lower():
            photos = embed_photos(url)
            if photos:
                items = list(photos)
                try:
                    info = yt_dlp.YoutubeDL(dict(opts, skip_download=True)).extract_info(
                        url, download=False, process=True)
                    aud = pick_audio(info.get('formats') or [])
                    if aud:
                        items.append({'type': 'audio', 'url': aud.get('url'),
                                      'id': info.get('id'), 'duration': info.get('duration')})
                except Exception:
                    pass
                return {'title': 'Instagram', 'channel': '', 'items': items}
        return {'error': str(e)}

    items = []
    if info.get('_type') == 'playlist' and info.get('entries'):
        for e in info['entries']:
            formats = e.get('formats') or []
            video_format = pick_video(formats)
            if video_format:
                items.append({
                    'type': 'video',
                    'url': video_format.get('url'),
                    'id': e.get('id'),
                    'duration': e.get('duration')
                })
            else:
                thumbs = e.get('thumbnails') or []
                if thumbs:
                    items.append({
                        'type': 'photo',
                        'url': thumbs[-1].get('url'),
                        'id': e.get('id')
                    })
    else:
        formats = info.get('formats') or []
        video_format = pick_video(formats)
        if video_format:
            items.append({
                'type': 'video',
                'url': video_format.get('url'),
                'id': info.get('id'),
                'duration': info.get('duration')
            })
        else:
            thumbs = info.get('thumbnails') or []
            if thumbs:
                items.append({
                    'type': 'photo',
                    'url': thumbs[-1].get('url'),
                    'id': info.get('id')
                })

    return {
        'title': info.get('title') or info.get('description') or 'Instagram',
        'channel': info.get('channel') or info.get('uploader'),
        'items': items
    }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No URL provided'}))
        sys.exit(1)
    url = sys.argv[1]
    cookies = sys.argv[2] if len(sys.argv) > 2 else None
    result = extract(url, cookies)
    print(json.dumps(result))
