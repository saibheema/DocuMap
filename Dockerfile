FROM node:20-alpine AS base
WORKDIR /app

# Install OCR tools for scanned PDF extraction
RUN apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-eng

COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm install

COPY . .
RUN npm run build -w @documap/api

EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@documap/api"]
