import asyncio
import importlib.util
import io
import shutil
import struct
import sys
import types
import unittest
import wave
from unittest.mock import patch

sys.modules.setdefault('imageio_ffmpeg', types.SimpleNamespace(get_ffmpeg_exe=lambda: 'ffmpeg'))
sys.modules.setdefault('yt_dlp', types.SimpleNamespace())
sys.modules.setdefault('livekit', types.SimpleNamespace(rtc=types.SimpleNamespace(AudioFrame=lambda data, *_: data)))
spec = importlib.util.spec_from_file_location('music_worker', __file__.replace('music_worker_test.py', 'music_worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class Reader:
    def __init__(self):
        self.index = 0

    async def readexactly(self, size):
        await asyncio.sleep(.005)
        if self.index == 20:
            raise asyncio.IncompleteReadError(b'', size)
        self.index += 1
        return bytes([self.index]) * size


class Process:
    def __init__(self):
        self.stdout = Reader()
        self.returncode = None

    async def wait(self):
        self.returncode = 0

    async def communicate(self):
        return b'', b''

    def kill(self):
        self.returncode = -1


class Source:
    def __init__(self):
        self.frames = []

    async def capture_frame(self, data):
        self.frames.append(data[0])

    async def wait_for_playout(self):
        pass

    def clear_queue(self):
        pass


class PlaybackTest(unittest.IsolatedAsyncioTestCase):
    async def test_pause_preserves_every_frame_and_resume_position(self):
        running = asyncio.Event()
        running.set()
        lock = asyncio.Lock()
        source = Source()
        process = Process()

        async def start(*args, **kwargs):
            return process

        with patch.object(worker, 'resolve', return_value={'url': 'fixture'}), patch.object(worker.asyncio, 'create_subprocess_exec', start), patch.object(worker, 'event'):
            task = asyncio.create_task(worker.play({'query': 'teste'}, source, running, lock))
            while len(source.frames) < 3:
                await asyncio.sleep(.005)
            running.clear()
            async with lock:
                await source.wait_for_playout()
            count = len(source.frames)
            await asyncio.sleep(.06)
            self.assertEqual(len(source.frames), count)
            running.set()
            await task
        self.assertEqual(source.frames, list(range(1, 21)))

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg não instalado')
    async def test_real_ffmpeg_stream_preserves_samples_after_pause(self):
        pcm = b''.join(struct.pack('<hh', n, n) * 960 for n in range(1, 51))
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as wav:
            wav.setnchannels(2)
            wav.setsampwidth(2)
            wav.setframerate(48000)
            wav.writeframes(pcm)
        body = audio.getvalue()

        async def respond(reader, writer):
            await reader.readuntil(b'\r\n\r\n')
            writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: ' + str(len(body)).encode() + b'\r\nConnection: close\r\n\r\n' + body)
            await writer.drain()
            writer.close()

        class TimedSource(Source):
            async def capture_frame(self, data):
                self.frames.append(data)
                await asyncio.sleep(.005)

        server = await asyncio.start_server(respond, '127.0.0.1', 0)
        port = server.sockets[0].getsockname()[1]
        running, lock, source = asyncio.Event(), asyncio.Lock(), TimedSource()
        running.set()
        try:
            with patch.object(worker, 'resolve', return_value={'url': f'http://127.0.0.1:{port}/test.wav'}), patch.object(worker.imageio_ffmpeg, 'get_ffmpeg_exe', return_value=shutil.which('ffmpeg')), patch.object(worker, 'event'):
                task = asyncio.create_task(worker.play({'query': 'teste'}, source, running, lock))
                while len(source.frames) < 3 and not task.done():
                    await asyncio.sleep(.005)
                self.assertFalse(task.done(), 'ffmpeg terminou antes da pausa')
                running.clear()
                async with lock:
                    await source.wait_for_playout()
                count = len(source.frames)
                await asyncio.sleep(.06)
                self.assertEqual(len(source.frames), count)
                running.set()
                await task
                self.assertEqual(b''.join(source.frames), pcm)
        finally:
            server.close()
            await server.wait_closed()


if __name__ == '__main__':
    unittest.main()
