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
        return {'error': str(e)}

    items = []
    if info.get('_type') == 'playlist' and info.get('entries'):
        for e in info['entries']:
            formats = e.get('formats') or []
            video_format = next((f for f in formats if f.get('vcodec') and f.get('vcodec') != 'none'), None)
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
        video_format = next((f for f in formats if f.get('vcodec') and f.get('vcodec') != 'none'), None)
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
