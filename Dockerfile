FROM oven/bun:1-debian

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates python3 python3-pip bc \
    && pip3 install pytest --break-system-packages \
    && rm -rf /var/lib/apt/lists/*

RUN git config --global user.email "organism@hallway.sh" \
    && git config --global user.name "organism"

RUN mkdir -p /work

COPY improve.ts /kernel/improve.ts
RUN chmod +x /kernel/improve.ts

WORKDIR /work
ENTRYPOINT ["bun", "run", "/kernel/improve.ts"]
