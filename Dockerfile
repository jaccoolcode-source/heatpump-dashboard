FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public/ ./public/
COPY collector/ ./collector/

RUN mkdir -p data

EXPOSE 3000

CMD ["node", "server.js"]
