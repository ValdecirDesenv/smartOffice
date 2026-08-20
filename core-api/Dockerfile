FROM node:20-alpine AS frontend-build
WORKDIR /front
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS build
WORKDIR /app
COPY core-api/package*.json ./
RUN npm install
COPY core-api/tsconfig.json ./
COPY core-api/src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY core-api/package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY core-api/src/db/migrations ./src/db/migrations
COPY --from=frontend-build /front/dist ./dist/static
COPY core-api/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 8080
CMD ["./docker-entrypoint.sh"]
