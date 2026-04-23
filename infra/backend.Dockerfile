FROM node:20-bookworm AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json

RUN npm install

COPY . .

RUN npm run build --workspace @brimble/frontend \
  && npm run build --workspace @brimble/backend

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ARG RAILPACK_VERSION=0.23.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl docker.io git unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://railpack.com/install.sh | RAILPACK_VERSION=${RAILPACK_VERSION} sh -s -- --bin-dir /usr/local/bin

COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/package-lock.json /app/package-lock.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/backend/dist /app/apps/backend/dist
COPY --from=build /app/apps/backend/package.json /app/apps/backend/package.json
COPY --from=build /app/apps/frontend/dist /app/apps/frontend/dist

EXPOSE 3000

CMD ["node", "apps/backend/dist/server.js"]
