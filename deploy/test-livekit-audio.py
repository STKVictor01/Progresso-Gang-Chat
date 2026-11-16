"""Dois participantes sintéticos trocam áudio e vídeo em um LiveKit isolado."""
import asyncio
import base64
import hashlib
import hmac
import json
import math
import struct
import time
from livekit import rtc

KEY = 'testonlykey'
SECRET = 'abcdefghijklmnopqrstuvwxyz1234567890'

def encode(data):
    return base64.urlsafe_b64encode(json.dumps(data,separators=(',',':')).encode()).rstrip(b'=')

def token(identity):
    now=int(time.time())
    payload={'iss':KEY,'sub':identity,'nbf':now-5,'exp':now+300,'video':{'roomJoin':True,'room':'teste-isolado','canPublish':True,'canSubscribe':True}}
    message=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode(payload)
    signature=base64.urlsafe_b64encode(hmac.new(SECRET.encode(),message,hashlib.sha256).digest()).rstrip(b'=')
    return (message+b'.'+signature).decode()

async def main():
    sender,receiver=rtc.Room(),rtc.Room()
    got_audio,got_video=asyncio.Event(),asyncio.Event()
    tasks=[]
    async def listen(track):
        async for event in rtc.AudioStream(track):
            if any(event.frame.data):
                got_audio.set()
                break
    async def watch(track):
        async for event in rtc.VideoStream(track):
            if event.frame.width and event.frame.height:
                got_video.set()
                break
    @receiver.on('track_subscribed')
    def on_track(track, _publication, _participant):
        if track.kind==rtc.TrackKind.KIND_AUDIO:
            tasks.append(asyncio.create_task(listen(track)))
        if track.kind==rtc.TrackKind.KIND_VIDEO:
            tasks.append(asyncio.create_task(watch(track)))
    try:
        await sender.connect('ws://127.0.0.1:7880',token('pessoa-a'))
        await receiver.connect('ws://127.0.0.1:7880',token('pessoa-b'))
        source=rtc.AudioSource(48000,1)
        track=rtc.LocalAudioTrack.create_audio_track('teste',source)
        await sender.local_participant.publish_track(track,rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        video_source=rtc.VideoSource(320,180)
        video=rtc.LocalVideoTrack.create_video_track('tela-sintetica',video_source)
        await sender.local_participant.publish_track(video,rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_SCREENSHARE))
        frame=rtc.VideoFrame(320,180,rtc.VideoBufferType.RGBA,bytes([180,30,30,255])*(320*180))
        samples=struct.pack('<960h',*(int(8000*math.sin(2*math.pi*440*i/48000)) for i in range(960)))
        for _ in range(150):
            video_source.capture_frame(frame)
            await source.capture_frame(rtc.AudioFrame(samples,48000,1,960))
            if got_audio.is_set() and got_video.is_set():break
        await asyncio.wait_for(got_audio.wait(),10)
        await asyncio.wait_for(got_video.wait(),10)
        print('Dois participantes conectaram e receberam áudio e vídeo sintéticos.')
    finally:
        for task in tasks:task.cancel()
        await sender.disconnect()
        await receiver.disconnect()

asyncio.run(main())
