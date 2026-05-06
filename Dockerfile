FROM node:20-alpine

ARG SERVICE_PATH
ENV NODE_ENV=production

WORKDIR /app/${SERVICE_PATH}

COPY ${SERVICE_PATH}/package*.json ./
RUN npm ci --omit=dev

WORKDIR /app

COPY shared ./shared
COPY ${SERVICE_PATH} ./${SERVICE_PATH}

WORKDIR /app/${SERVICE_PATH}

CMD ["node", "index.js"]
