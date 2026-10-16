FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/app/var/wordchamp.sqlite
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev --cache /tmp/npm-cache --fetch-retries=1 --fetch-timeout=30000 && rm -rf /tmp/npm-cache
COPY --chown=node:node server.js db.js game.js backup.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node data ./data
RUN mkdir -p /app/var && chown node:node /app/var
USER node
EXPOSE 3000
VOLUME ["/app/var"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
