FROM node:22-alpine
WORKDIR /app
COPY package.json services.json ./
COPY src ./src
COPY public ./public
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
USER node
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "src/server.js"]
