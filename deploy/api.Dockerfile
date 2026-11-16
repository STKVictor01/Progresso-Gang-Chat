FROM node:24.22.3-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/music
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/music-requirements.txt ./
COPY deploy/music-constraints.txt ./
RUN /opt/music/bin/pip install --no-cache-dir -r music-requirements.txt -c music-constraints.txt
COPY server/*.js server/music_worker.py ./
RUN mkdir -p /app/server/data /app/server/logs && chown -R node:node /app/server
USER node
ENV NODE_ENV=production PG_CHAT_PYTHON=/opt/music/bin/python
CMD ["node", "index.js"]
