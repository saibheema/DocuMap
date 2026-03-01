FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm install

COPY . .
RUN npm run build -w @documap/shared
RUN npm run build -w @documap/api

EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
