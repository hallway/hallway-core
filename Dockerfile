FROM oven/bun:1-debian

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates python3 python3-pip bc \
    && pip3 install pytest --break-system-packages \
    && rm -rf /var/lib/apt/lists/*

RUN git config --global user.email "kernel@hallway.sh" \
    && git config --global user.name "hallway-core"

COPY improve.ts /kernel/improve.ts
COPY Dockerfile /kernel/Dockerfile
RUN chmod +x /kernel/improve.ts

WORKDIR /kernel
ENTRYPOINT ["bun", "run", "/kernel/improve.ts", "/kernel"]
