"""Isolated LiveKit music worker; the parent sends its credentials through stdin."""
import asyncio
import json
import sys
import subprocess
import imageio_ffmpeg
import yt_dlp
from livekit import rtc

async def main():
    settings = json.loads(sys.stdin.readline())
    with yt_dlp.YoutubeDL({'format':'bestaudio/best', 'noplaylist':True, 'quiet':True, 'no_warnings':True, 'socket_timeout':15}) as ydl:
        info = await asyncio.to_thread(ydl.extract_info, settings['url'], download=False)
    headers = ''.join(f'{k}: {v}\r\n' for k,v in (info.get('http_headers') or {}).items() if '\n' not in str(v) and '\r' not in str(v))
    room = rtc.Room()
    await room.connect(settings['serverUrl'], settings['token'])
    source = rtc.AudioSource(48000, 2)
    track = rtc.LocalAudioTrack.create_audio_track('Música', source)
    await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
    print(json.dumps({'event':'playing','title':str(info.get('title') or 'Música')[:200]}), flush=True)
    process = None
    try:
        process = await asyncio.create_subprocess_exec(imageio_ffmpeg.get_ffmpeg_exe(), '-v','error','-headers',headers,'-i',info['url'], '-f','s16le','-ac','2','-ar','48000','-', stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        while True:
            try: data = await process.stdout.readexactly(3840)
            except asyncio.IncompleteReadError as end:
                if end.partial:
                    data = end.partial + bytes(3840-len(end.partial))
                else: break
            await source.capture_frame(rtc.AudioFrame(data,48000,2,960))
        await process.wait()
        if process.returncode: raise RuntimeError('Erro ao reproduzir áudio')
        await source.wait_for_playout()
    finally:
        if process and process.returncode is None:
            process.kill()
            await process.wait()
        await room.disconnect()

try:
    asyncio.run(main())
except Exception:
    print(json.dumps({'event':'error','message':'Não foi possível reproduzir esse link. Tente outro vídeo.'}), flush=True)
    sys.exit(1)
