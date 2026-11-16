"""One LiveKit connection per room; the parent sends credentials and commands on stdin."""
import asyncio
import json
import re
import subprocess
import sys

import imageio_ffmpeg
import yt_dlp
from livekit import rtc


def event(kind, **data):
    print(json.dumps({'event': kind, **data}), flush=True)


async def play(item, source):
    process = None
    try:
        def resolve():
            with yt_dlp.YoutubeDL({'format': 'bestaudio/best', 'noplaylist': True, 'quiet': True, 'no_warnings': True, 'socket_timeout': 15}) as ydl:
                return ydl.extract_info(item['url'] if 'url' in item else 'ytsearch1:' + item['query'], download=False)

        info = await asyncio.to_thread(resolve)
        if 'entries' in info:
            info = next((entry for entry in info['entries'] if entry), None)
        if not info or not re.fullmatch(r'[a-zA-Z0-9_-]{11}', str(info.get('id', ''))):
            raise RuntimeError('Nenhum vídeo encontrado')
        headers = ''.join(f'{k}: {v}\r\n' for k, v in (info.get('http_headers') or {}).items() if '\n' not in str(v) and '\r' not in str(v))
        process = await asyncio.create_subprocess_exec(imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-headers', headers, '-i', info['url'], '-f', 's16le', '-ac', '2', '-ar', '48000', '-', stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        event('playing', title=str(info.get('title') or 'Música')[:200], url='https://www.youtube.com/watch?v=' + info['id'])
        while True:
            try:
                data = await process.stdout.readexactly(3840)
            except asyncio.IncompleteReadError as end:
                if not end.partial:
                    break
                data = end.partial + bytes(3840 - len(end.partial))
            await source.capture_frame(rtc.AudioFrame(data, 48000, 2, 960))
        await process.wait()
        if process.returncode:
            raise RuntimeError('Erro ao reproduzir áudio')
        await source.wait_for_playout()
    except asyncio.CancelledError:
        source.clear_queue()
        raise
    except Exception:
        event('error', message='Não foi possível encontrar ou reproduzir essa música. Tente outro nome ou link.')
    finally:
        if process and process.returncode is None:
            process.kill()
            await process.wait()
        event('finished')


async def main():
    settings = json.loads(await asyncio.to_thread(sys.stdin.readline))
    room = rtc.Room()
    room.on('disconnected', lambda *_: event('disconnected'))
    task = None
    try:
        await room.connect(settings['serverUrl'], settings['token'])
        source = rtc.AudioSource(48000, 2)
        track = rtc.LocalAudioTrack.create_audio_track('Música', source)
        await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        event('ready')
        while line := await asyncio.to_thread(sys.stdin.readline):
            command = json.loads(line)
            if command.get('command') == 'play' and (not task or task.done()):
                task = asyncio.create_task(play(command, source))
            elif command.get('command') == 'skip' and task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
    finally:
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await room.disconnect()


try:
    asyncio.run(main())
except Exception:
    event('error', message='O serviço de música não conseguiu se conectar à call.')
    sys.exit(1)
