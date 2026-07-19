FROM oven/bun:1
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "index.ts"]
