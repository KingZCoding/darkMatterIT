# D3 test case (bad): another project's local image as the base.
# expect: FROM social-agents-core:latest is not on the pinned list
# The mailer Dockerfile with that one change; run by deploy/pi/test/run-compose-cases.py.
FROM social-agents-core:latest

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY app.js server.js ./

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "server.js"]
