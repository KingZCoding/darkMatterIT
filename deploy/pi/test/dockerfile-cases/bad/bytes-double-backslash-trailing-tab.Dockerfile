# D3-fix1 test case (bad): two backslashes then a tab, then a second FROM
# expect: ends in two backslashes
# The mailer Dockerfile with that one change; run by deploy/pi/test/run-compose-cases.py (bytes-* files are -text in .gitattributes).
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

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
RUN echo \\	
FROM localimg
