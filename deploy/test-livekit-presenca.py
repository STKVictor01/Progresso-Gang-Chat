"""Teste local de presença: 20 clientes sintéticos, sem carga de vídeo."""
import asyncio
import base64
import hashlib
import hmac
import json
import time
from livekit import rtc

def encode(data):
    return base64.urlsafe_b64encode(json.dumps(data,separators=(',',':')).encode()).rstrip(b'=')

def token(identity):
    now=int(time.time())
    claims={'iss':'testonlykey','sub':identity,'nbf':now-5,'exp':now+300,'video':{'roomJoin':True,'room':'presenca-isolada','canPublish':True,'canSubscribe':True}}
    message=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode(claims)
    return (message+b'.'+base64.urlsafe_b64encode(hmac.new(b'abcdefghijklmnopqrstuvwxyz1234567890',message,hashlib.sha256).digest()).rstrip(b'=')).decode()

async def main():
    rooms=[rtc.Room() for _ in range(20)]
    try:
        start=time.monotonic()
        await asyncio.wait_for(asyncio.gather(*(room.connect('ws://127.0.0.1:7880',token('pessoa-'+str(i))) for i,room in enumerate(rooms))),60)
        for _ in range(100):
            if all(len(room.remote_participants)==19 for room in rooms):break
            await asyncio.sleep(.1)
        assert all(len(room.remote_participants)==19 for room in rooms), 'Presença incompleta'
        print(f'20 participantes conectados, presença sincronizada em {time.monotonic()-start:.1f}s.',flush=True)
        await asyncio.sleep(8)
    finally:
        await asyncio.gather(*(room.disconnect() for room in rooms),return_exceptions=True)

asyncio.run(main())
