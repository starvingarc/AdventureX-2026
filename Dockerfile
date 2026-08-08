FROM node:20-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY docs/privacy-policy.html docs/support.html ./docs/

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV OMO_PUBLIC_PAGES_DIR=/app/docs

USER node

CMD ["npm", "start"]
