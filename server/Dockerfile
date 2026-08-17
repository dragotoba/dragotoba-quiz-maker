FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY migrations ./migrations
COPY src ./src

USER node
EXPOSE 3001
CMD ["sh", "-c", "npm run migrate && npm start"]
