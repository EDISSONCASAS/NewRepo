FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS backend-build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./tsconfig.json
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    ACADEMIES_DATA_DIR=/var/data \
    ACADEMIES_WEB_DIR=/app/public
COPY --from=backend-build /app/package.json ./backend/package.json
COPY --from=backend-build /app/node_modules ./backend/node_modules
COPY --from=backend-build /app/dist ./backend/dist
COPY --from=frontend-build /app/dist ./public
EXPOSE 10000
CMD ["node", "backend/dist/src/server.js"]
