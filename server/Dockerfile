FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY migrations ./migrations
COPY src ./src

USER node
CMD ["npm", "start"]
