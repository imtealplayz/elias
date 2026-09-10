FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN echo "Elias build source: v1.0.3" && node --version

CMD ["sh", "-c", "echo 'Elias build source: v1.0.3' && node --version && npm start"]
