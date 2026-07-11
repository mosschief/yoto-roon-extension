FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/mosschief/yoto-roon-extension" \
      org.opencontainers.image.description="Sync Pitchfork Best New Music and Aquarium Drunkard picks into a TIDAL/Qobuz playlist that shows up in Roon"
WORKDIR /app
COPY package.json config.example.json ./
COPY src ./src
# Configure via environment variables (see README); persist /app/data.
CMD ["node", "src/index.js", "sync", "--loop"]
