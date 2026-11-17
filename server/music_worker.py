"""One LiveKit connection per room; the parent sends credentials and commands on stdin."""
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys

import imageio_ffmpeg
import yt_dlp
from livekit import rtc


def event(kind, **data):
    print(json.dumps({'event': kind, **data}), flush=True)


def log(message):
    # Vai para os registros do servidor; ajuda a descobrir por que uma música falhou.
    print(str(message)[:500], file=sys.stderr, flush=True)


def ydl_options():
    options = {'format': 'bestaudio/best', 'noplaylist': True, 'quiet': True, 'no_warnings': True, 'socket_timeout': 15}
    # Desde 2025 o YouTube exige um motor de JavaScript; o servidor já tem o Node.
    if shutil.which('node'):
        options['js_runtimes'] = {'node': {}}
    cookies = os.environ.get('PG_CHAT_YTDLP_COOKIES')
    if cookies and os.path.isfile(cookies):
        options['cookiefile'] = cookies
    return options


def blocked(error):
    text = str(error).lower()
    return 'sign in to confirm' in text or 'not a bot' in text or 'http error 429' in text


def resolve(item):
    targets = [item['url']] if 'url' in item else ['ytsearch1:' + item['query'], 'scsearch1:' + item['query']]
    last = None
    for target in targets:
        try:
            with yt_dlp.YoutubeDL(ydl_options()) as ydl:
                info = ydl.extract_info(target, download=False)
            if info and 'entries' in info:
                info = next((entry for entry in info['entries'] if entry), None)
            if info and info.get('url'):
                return info
            last = RuntimeError('Nenhum resultado para ' + target.split(':', 1)[0])
        except Exception as error:  # Tenta a próxima fonte (SoundCloud) quando a busca no YouTube falha.
            log(f'{target.split(":", 1)[0] if target.startswith(("ytsearch", "scsearch")) else "youtube"}: {type(error).__name__}: {error}')
            last = error
    raise last or RuntimeError('Nenhum resultado')


async def play(item, source):
    process = None
    try:
        info = await asyncio.to_thread(resolve, item)
        youtube = re.fullmatch(r'[a-zA-Z0-9_-]{11}', str(info.get('id', ''))) and 'youtube' in str(info.get('extractor', 'youtube')).lower()
        headers = ''.join(f'{k}: {v}\r\n' for k, v in (info.get('http_headers') or {}).items() if '\n' not in str(v) and '\r' not in str(v))
        process = await asyncio.create_subprocess_exec(imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-headers', headers, '-i', info['url'], '-f', 's16le', '-ac', '2', '-ar', '48000', '-', stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        event('playing', title=str(info.get('title') or 'Música')[:200], url='https://www.youtube.com/watch?v=' + info['id'] if youtube else '')
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
    except Exception as error:
        log(f'falha ao tocar: {type(error).__name__}: {error}')
        if blocked(error):
            event('error', message='O YouTube bloqueou o servidor de música. Tente pelo nome da música, sem link.')
        else:
            event('error', message='Não foi possível encontrar ou reproduzir essa música. Tente outro nome ou link.')
    finally:
        if process:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
            # Drene o pipe antes de esperar: no Linux um pipe cheio impede o encerramento.
            await process.communicate()


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
                task.add_done_callback(lambda _: event('finished'))
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
except Exception as failure:
    log(f'conexão: {type(failure).__name__}: {failure}')
    event('error', message='O serviço de música não conseguiu se conectar à call.')
    sys.exit(1)
