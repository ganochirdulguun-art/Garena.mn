# Garena.mn hostbot — GHost++ 17.2 (Shiox/ghostpp) + Node bridge. ДРАФТ: VPS дээр туршина (Railway-д UDP/олон порт байхгүй тул тохирохгүй).
FROM ubuntu:22.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git libgmp-dev libbz2-dev zlib1g-dev libmysqlclient-dev libsqlite3-dev ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 https://github.com/Shiox/ghostpp.git . \
 && mkdir build && cd build && cmake .. && make -j"$(nproc)"

FROM ubuntu:22.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgmp10 libbz2-1.0 zlib1g libsqlite3-0 libmysqlclient21 ca-certificates curl python3 make g++ \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# GHost++ binary + language/motd файлууд
COPY --from=build /src/build/ghost++ /app/ghost++
COPY --from=build /src/language.cfg /app/language.cfg
# bridge
COPY package.json bridge.js ghost.cfg.template /app/
COPY mapcfgs /app/mapcfgs
RUN npm install --omit=dev && mkdir -p maps replays savegames run
# maps/ хавтсанд map файлуудыг (LoD v5e.w3x), /opt/war3-д War3Patch.mpq, War3x.mpq-г mount хийнэ
VOLUME ["/app/maps", "/opt/war3", "/app/run", "/app/replays"]
EXPOSE 6112-6130/tcp 6300/tcp
ENV GHOST_DIR=/app GHOST_BIN=./ghost++ WAR3_PATH=/opt/war3/ BASE_PORT=6112 MAX_GAMES=2
CMD ["node", "bridge.js"]
