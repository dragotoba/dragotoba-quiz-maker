# Multi-stage: build the SPA, then run a tiny Node static server with no node_modules.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# package.json is required when Railway overrides CMD with `npm start`
COPY package.json ./
COPY server.mjs ./
COPY --from=build /app/dist ./dist

USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
