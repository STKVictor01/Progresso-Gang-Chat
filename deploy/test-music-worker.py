"""Teste de integração contra um LiveKit isolado, com áudio sintético local."""
import asyncio
import base64
import hashlib
import hmac
import http.server
import json
import math
import os
from pathlib import Path
import struct
import sys
import tempfile
import threading
import time
import wave

from livekit import rtc


def token(identity):
    def encode(data):
        return base64.urlsafe_b64encode(json.dumps(data, separators=(',', ':')).encode()).rstrip(b'=')
    now = int(time.time())
    message = encode({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode({'iss': 'testonlykey', 'sub': identity, 'nbf': now - 5, 'exp': now + 300, 'video': {'roomJoin': True, 'room': 'musica-isolada', 'canPublish': True, 'canSubscribe': True}})
    return (message + b'.' + base64.urlsafe_b64encode(hmac.new(b'abcdefghijklmnopqrstuvwxyz1234567890', message, hashlib.sha256).digest()).rstrip(b'=')).decode()


async def main():
    with tempfile.TemporaryDirectory(prefix='music-worker-qa-') as folder:
        tone = Path(folder, 'tone.wav')
        with wave.open(str(tone), 'wb') as output:
            output.setparams((2, 2, 48000, 0, 'NONE', 'not compressed'))
            output.writeframes(b''.join(struct.pack('<hh', int(8000 * math.sin(2 * math.pi * 440 * i / 48000)), int(8000 * math.sin(2 * math.pi * 440 * i / 48000))) for i in range(96000)))
        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=folder, **kwargs)
            def log_message(self, *_args):
                pass
        web = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=web.serve_forever, daemon=True).start()
        audio_url = f'http://127.0.0.1:{web.server_port}/tone.wav'
        Path(folder, 'yt_dlp.py').write_text("class YoutubeDL:\n def __init__(self,*a,**k): pass\n def __enter__(self): return self\n def __exit__(self,*a): pass\n def extract_info(self,*a,**k): return {'id':'abcdefghijk','title':'Som sintético','url':" + repr(audio_url) + ", 'http_headers':{}}\n")
        env = {**os.environ, 'PYTHONPATH': folder}
        worker = await asyncio.create_subprocess_exec(sys.executable, '-u', '/test/server/music_worker.py', stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env)
        room = rtc.Room()
        frames = 0
        listeners = []

        @room.on('track_subscribed')
        def subscribed(track, _publication, _participant):
            async def listen():
                nonlocal frames
                async for sample in rtc.AudioStream(track):
                    if any(sample.frame.data):
                        frames += 1
            listeners.append(asyncio.create_task(listen()))

        async def send(data):
            worker.stdin.write((json.dumps(data) + '\n').encode())
            await worker.stdin.drain()

        async def wait_event(kind):
            while True:
                line = await asyncio.wait_for(worker.stdout.readline(), 25)
                if not line:
                    raise AssertionError('Worker terminou antes do evento esperado')
                message = json.loads(line)
                if message['event'] == 'error':
                    raise AssertionError(message['message'])
                if message['event'] == kind:
                    return

        try:
            url = os.environ['QA_LIVEKIT_URL']
            await room.connect(url, token('ouvinte'))
            await send({'serverUrl': url, 'token': token('music-bot:teste')})
            await wait_event('ready')
            for song in ('primeira', 'segunda'):
                before = frames
                await send({'command': 'play', 'query': song})
                await wait_event('playing')
                await wait_event('finished')
                assert frames > before, 'O ouvinte não recebeu o áudio da música'
                assert 'music-bot:teste' in room.remote_participants, 'O bot saiu da sala entre músicas'
            print('Bot conectado durante duas músicas; ouvinte recebeu áudio nas duas.')
        finally:
            worker.stdin.close()
            try:
                await asyncio.wait_for(worker.wait(), 10)
            except asyncio.TimeoutError:
                worker.kill()
                await worker.wait()
            for listener in listeners:
                listener.cancel()
            await room.disconnect()
            web.shutdown()


asyncio.run(main())
