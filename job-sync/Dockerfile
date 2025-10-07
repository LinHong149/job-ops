FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js ./server.js
ENV NODE_ENV=production

EXPOSE 8719
CMD ["node", "server.js"]