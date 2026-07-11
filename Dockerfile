FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
# Mount /app/config.json, /app/.env and /app/data at runtime.
CMD ["node", "src/index.js", "sync", "--loop"]
