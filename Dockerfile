FROM node:22-bookworm-slim
WORKDIR /srv
ENV NEXT_TELEMETRY_DISABLED=1
COPY engine/package.json engine/package-lock.json engine/
COPY app/package.json app/package-lock.json app/
RUN cd engine && npm ci && cd ../app && npm ci
COPY . .
RUN cd app && NODE_OPTIONS=--max-old-space-size=4096 npx next build
ENV NODE_ENV=production
CMD ["node", "scripts/serve.mjs"]
