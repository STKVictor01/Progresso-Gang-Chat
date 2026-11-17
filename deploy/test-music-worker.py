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
            second = b''.join(struct.pack('<hh', int(8000 * math.sin(2 * math.pi * 440 * i / 48000)), int(8000 * math.sin(2 * math.pi * 440 * i / 48000))) for i in range(48000))
            output.writeframes(second * 30)
        with wave.open(str(Path(folder, 'short.wav')), 'wb') as output:
            output.setparams((2, 2, 48000, 0, 'NONE', 'not compressed'))
            output.writeframes(second * 2)
        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=folder, **kwargs)
            def log_message(self, *_args):
                pass
        class TestServer(http.server.ThreadingHTTPServer):
            def handle_error(self, request, address):
                if not isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
                    super().handle_error(request, address)
        web = TestServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=web.serve_forever, daemon=True).start()
        audio_url = f'http://127.0.0.1:{web.server_port}/tone.wav'
        Path(folder, 'yt_dlp.py').write_text("import time\nclass YoutubeDL:\n def __init__(self,*a,**k): pass\n def __enter__(self): return self\n def __exit__(self,*a): pass\n def extract_info(self,target,*a,**k):\n  if 'lento' in target: time.sleep(2)\n  url=" + repr(audio_url) + "\n  if 'curta' in target: url=url.replace('tone.wav','short.wav')\n  return {'id':'abcdefghijk','title':'Som sintético','url':url, 'http_headers':{}}\n", encoding='utf-8')
        env = {**os.environ, 'PYTHONPATH': folder}
        worker_path = Path(__file__).resolve().parent.parent / 'server' / 'music_worker.py'
        worker = await asyncio.create_subprocess_exec(sys.executable, '-u', str(worker_path), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env)
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
            try:
                await worker.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                raise AssertionError('Worker encerrou: ' + (await worker.stderr.read()).decode(errors='replace'))

        async def wait_event(kind, timeout=25):
            while True:
                line = await asyncio.wait_for(worker.stdout.readline(), timeout)
                if not line:
                    raise AssertionError('Worker terminou antes do evento esperado: ' + (await worker.stderr.read()).decode(errors='replace'))
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
            await send({'command': 'play', 'query': 'lento'})
            await asyncio.sleep(0.2)
            await send({'command': 'skip'})
            await wait_event('finished', 1)
            for song in ('primeira', 'segunda'):
                before = frames
                await send({'command': 'play', 'query': song})
                await wait_event('playing')
                for _ in range(40):
                    if frames > before:
                        break
                    await asyncio.sleep(0.05)
                assert frames > before, 'O ouvinte não recebeu o áudio da música'
                await send({'command': 'skip'})
                await wait_event('finished', 8)
                assert 'music-bot:teste' in room.remote_participants, 'O bot saiu da sala entre músicas'
            before = frames
            await send({'command': 'play', 'query': 'curta'})
            await wait_event('playing')
            await wait_event('finished', 8)
            assert frames > before, 'A música seguinte não foi reproduzida até o fim'
            print('Bot pulou durante carregamento e reprodução, tocou até o fim e manteve a conexão.')
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
